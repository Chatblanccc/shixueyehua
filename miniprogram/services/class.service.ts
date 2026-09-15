import {
  parseClassPage,
  parseCurrentClass,
  parseGradePage,
  parseLoginResult,
  parseSchoolPage,
} from '../generated/shared';
import type { ClassSelectionInput } from '../generated/shared';
import { callCloud } from './cloud-api';

export const classService = {
  listSchools: (cursor?: string) =>
    callCloud('classApi', 'listSchools', parseSchoolPage, { cursor, pageSize: 20 }),
  listGrades: (schoolId: string, cursor?: string) =>
    callCloud('classApi', 'listGrades', parseGradePage, { schoolId, cursor, pageSize: 20 }),
  listClasses: (schoolId: string, gradeId: string, cursor?: string) =>
    callCloud('classApi', 'listClasses', parseClassPage, {
      schoolId,
      gradeId,
      cursor,
      pageSize: 20,
    }),
  selectClass: (payload: ClassSelectionInput) =>
    callCloud('classApi', 'selectClass', parseLoginResult, payload),
  getCurrentClass: () => callCloud('classApi', 'getCurrentClass', parseCurrentClass),
};
