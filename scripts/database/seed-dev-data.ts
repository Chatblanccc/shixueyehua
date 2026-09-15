import type { DocumentData } from './core';
import { DEFAULT_SYSTEM_CONFIG } from '../../shared/domain';

export const SEED_SCHOOL_ID = 'dev-school-shixue';

export function developmentSeeds(timestamp: unknown): ReadonlyArray<{
  collection: string;
  id: string;
  data: DocumentData;
}> {
  const common = { createdAt: timestamp, updatedAt: timestamp };
  return [
    {
      collection: 'schools',
      id: SEED_SCHOOL_ID,
      data: { ...common, name: '实学测试学校（虚构）', status: 'active' },
    },
    ...[7, 8].map((grade) => ({
      collection: 'grades',
      id: `dev-grade-${grade}`,
      data: {
        ...common,
        schoolId: SEED_SCHOOL_ID,
        name: grade === 7 ? '七年级' : '八年级',
        sortOrder: grade,
        status: 'active',
      },
    })),
    ...[7, 8].flatMap((grade) =>
      [1, 2].map((classNumber) => ({
        collection: 'classes',
        id: `dev-class-${grade}-${classNumber}`,
        data: {
          ...common,
          schoolId: SEED_SCHOOL_ID,
          gradeId: `dev-grade-${grade}`,
          name: `${classNumber}班`,
          joinMode: 'free',
          sortOrder: classNumber,
          status: 'active',
        },
      })),
    ),
    {
      collection: 'system_configs',
      id: 'app:global',
      data: {
        ...common,
        key: 'app',
        updatedBy: 'system:seed-dev',
        value: { ...DEFAULT_SYSTEM_CONFIG },
      },
    },
  ];
}
