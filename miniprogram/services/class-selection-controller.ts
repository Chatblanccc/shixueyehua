import type {
  ClassOption,
  ClassSelectionInput,
  CurrentClass,
  CursorPage,
  GradeOption,
  SchoolOption,
  UserProfile,
} from '../generated/shared';
import { userStore } from '../stores/user.store';
import { classService } from './class.service';
import { CloudClientError } from './cloud-client';
import { ensureUserSession, mutateSession } from './session.service';

export type SelectionLevel = 'schools' | 'grades' | 'classes';
export interface OptionList<T> {
  items: T[];
  loading: boolean;
  errorMessage: string;
  hasMore: boolean;
}
export interface ClassSelectionSnapshot {
  schools: OptionList<SchoolOption>;
  grades: OptionList<GradeOption>;
  classes: OptionList<ClassOption>;
  selectedSchool: SchoolOption | null;
  selectedGrade: GradeOption | null;
  selectedClass: ClassOption | null;
  saving: boolean;
  previewMode: boolean;
  errorMessage: string;
}
export interface ClassSelectionPort {
  previewMode: boolean;
  getUser(): UserProfile | null;
  ensureUser(): Promise<boolean>;
  listSchools(cursor?: string): Promise<CursorPage<SchoolOption>>;
  listGrades(schoolId: string, cursor?: string): Promise<CursorPage<GradeOption>>;
  listClasses(schoolId: string, gradeId: string, cursor?: string): Promise<CursorPage<ClassOption>>;
  getCurrentClass(): Promise<CurrentClass | null>;
  selectClass(input: ClassSelectionInput): Promise<unknown>;
}
const empty = <T>(): OptionList<T> => ({
  items: [],
  loading: false,
  errorMessage: '',
  hasMore: false,
});

export class ClassSelectionController {
  private state: ClassSelectionSnapshot;
  private listeners = new Set<(value: ClassSelectionSnapshot) => void>();
  private alive = true;
  private owner = '';
  private revision = { schools: 0, grades: 0, classes: 0 };
  private cursor: Partial<Record<SelectionLevel, string>> = {};
  constructor(private port: ClassSelectionPort) {
    this.state = {
      schools: empty(),
      grades: empty(),
      classes: empty(),
      selectedSchool: null,
      selectedGrade: null,
      selectedClass: null,
      saving: false,
      previewMode: port.previewMode,
      errorMessage: '',
    };
  }
  private snapshot(): ClassSelectionSnapshot {
    return {
      ...this.state,
      schools: { ...this.state.schools, items: [...this.state.schools.items] },
      grades: { ...this.state.grades, items: [...this.state.grades.items] },
      classes: { ...this.state.classes, items: [...this.state.classes.items] },
    };
  }
  subscribe(listener: (value: ClassSelectionSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    if (this.alive) for (const listener of this.listeners) listener(this.snapshot());
  }
  async load(): Promise<void> {
    if (this.port.previewMode) {
      this.state.errorMessage = '学校与班级服务暂未启用，云环境配置后即可选择';
      this.emit();
      return;
    }
    try {
      if (!(await this.port.ensureUser()) || !this.alive) return;
      const user = this.port.getUser();
      this.owner = user?._id ?? '';
      if (!user?.identity) {
        this.state.errorMessage = '请先完善身份，再选择班级';
        this.emit();
        return;
      }
      await this.fetch('schools');
    } catch (error: unknown) {
      this.state.errorMessage = this.message(error);
      this.emit();
    }
  }
  private clear(level: SelectionLevel): void {
    this.revision[level]++;
    delete this.cursor[level];
    if (level === 'schools') {
      this.state.schools = empty();
      this.state.selectedSchool = null;
    }
    if (level === 'grades') {
      this.state.grades = empty();
      this.state.selectedGrade = null;
    }
    if (level === 'classes') {
      this.state.classes = empty();
      this.state.selectedClass = null;
    }
  }
  async chooseSchool(id: string): Promise<void> {
    if (!this.alive || this.state.saving) return;
    const school = this.state.schools.items.find((item) => item._id === id);
    if (!school || school._id === this.state.selectedSchool?._id) return;
    this.state.selectedSchool = school;
    this.clear('grades');
    this.clear('classes');
    this.state.errorMessage = '';
    this.emit();
    await this.fetch('grades');
  }
  async chooseGrade(id: string): Promise<void> {
    if (!this.alive || this.state.saving) return;
    const grade = this.state.grades.items.find((item) => item._id === id);
    if (
      !grade ||
      grade.schoolId !== this.state.selectedSchool?._id ||
      grade._id === this.state.selectedGrade?._id
    )
      return;
    this.state.selectedGrade = grade;
    this.clear('classes');
    this.state.errorMessage = '';
    this.emit();
    await this.fetch('classes');
  }
  chooseClass(id: string): void {
    if (!this.alive || this.state.saving) return;
    const entry = this.state.classes.items.find((item) => item._id === id);
    if (
      !entry ||
      entry.schoolId !== this.state.selectedSchool?._id ||
      entry.gradeId !== this.state.selectedGrade?._id ||
      entry.joinMode !== 'free'
    )
      return;
    this.state.selectedClass = entry;
    this.state.errorMessage = '';
    this.emit();
  }
  async loadMore(level: SelectionLevel): Promise<void> {
    if (this.state[level].hasMore) await this.fetch(level, true);
  }
  async retry(level: SelectionLevel): Promise<void> {
    await this.fetch(level, Boolean(this.cursor[level]));
  }
  private async fetch(level: SelectionLevel, more = false): Promise<void> {
    if (!this.alive || this.port.previewMode || this.state[level].loading) return;
    const schoolId = this.state.selectedSchool?._id;
    const gradeId = this.state.selectedGrade?._id;
    if ((level !== 'schools' && !schoolId) || (level === 'classes' && !gradeId)) return;
    const revision = ++this.revision[level];
    const cursor = more ? this.cursor[level] : undefined;
    this.state[level].loading = true;
    this.state[level].errorMessage = '';
    this.emit();
    try {
      const response =
        level === 'schools'
          ? await this.port.listSchools(cursor)
          : level === 'grades'
            ? await this.port.listGrades(schoolId!, cursor)
            : await this.port.listClasses(schoolId!, gradeId!, cursor);
      if (!this.alive || revision !== this.revision[level]) return;
      if (response.nextCursor && response.nextCursor === cursor)
        throw new CloudClientError('INVALID_RESPONSE', 'class-cursor');
      const previous = more ? this.state[level].items : [];
      const merged = [...previous, ...response.items].filter(
        (item, index, all) => all.findIndex((other) => other._id === item._id) === index,
      );
      if (level === 'schools') this.state.schools.items = merged as SchoolOption[];
      else if (level === 'grades') {
        if (!merged.every((item) => 'schoolId' in item && item.schoolId === schoolId))
          throw new CloudClientError('INVALID_RESPONSE', 'class-scope');
        this.state.grades.items = merged as GradeOption[];
      } else {
        if (
          !merged.every(
            (item) =>
              'schoolId' in item &&
              item.schoolId === schoolId &&
              'gradeId' in item &&
              item.gradeId === gradeId &&
              'joinMode' in item &&
              item.joinMode === 'free',
          )
        )
          throw new CloudClientError('INVALID_RESPONSE', 'class-scope');
        this.state.classes.items = merged as ClassOption[];
      }
      this.cursor[level] = response.nextCursor;
      this.state[level].hasMore = Boolean(response.nextCursor);
    } catch (error: unknown) {
      if (this.alive && revision === this.revision[level])
        this.state[level].errorMessage = this.message(error);
    } finally {
      if (this.alive && revision === this.revision[level]) {
        this.state[level].loading = false;
        this.emit();
      }
    }
  }
  async submit(): Promise<boolean> {
    if (!this.alive || this.state.saving) return false;
    if (this.port.previewMode) {
      this.state.errorMessage = '云服务启用后才能保存班级';
      this.emit();
      return false;
    }
    const school = this.state.selectedSchool,
      grade = this.state.selectedGrade,
      entry = this.state.selectedClass;
    if (!school || !grade || !entry) {
      this.state.errorMessage = '请依次选择学校、年级和班级';
      this.emit();
      return false;
    }
    if (!this.owner || this.port.getUser()?._id !== this.owner) {
      this.state.errorMessage = '登录状态已变化，请重新进入';
      this.emit();
      return false;
    }
    this.state.saving = true;
    this.state.errorMessage = '';
    this.emit();
    try {
      await this.port.selectClass({ schoolId: school._id, gradeId: grade._id, classId: entry._id });
      return this.alive;
    } catch (error: unknown) {
      if (this.alive) this.state.errorMessage = this.message(error);
      return false;
    } finally {
      if (this.alive) {
        this.state.saving = false;
        this.emit();
      }
    }
  }
  private message(error: unknown): string {
    return error instanceof CloudClientError ? error.message : '班级信息暂时无法加载，请重试';
  }
  dispose(): void {
    this.alive = false;
    for (const level of ['schools', 'grades', 'classes'] as const) this.revision[level]++;
    this.listeners.clear();
  }
}
export const createClassSelectionController = () =>
  new ClassSelectionController({
    previewMode: userStore.previewMode,
    getUser: () => userStore.user,
    ensureUser: ensureUserSession,
    ...classService,
    selectClass: (input) => mutateSession(() => classService.selectClass(input)),
  });
