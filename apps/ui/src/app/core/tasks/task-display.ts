import type { LabelColor, Priority, StatusCategory, TaskType } from '@glacier-tasks/domain';
import type { TranslationKey } from '../i18n/i18n.service';

/** Translation keys for fixed task enumerations. */
export const PRIORITY_KEYS: Record<Priority, TranslationKey> = {
  LOW: 'priority.LOW',
  MEDIUM: 'priority.MEDIUM',
  HIGH: 'priority.HIGH',
  CRITICAL: 'priority.CRITICAL',
};

export const TASK_TYPE_KEYS: Record<TaskType, TranslationKey> = {
  STORY: 'taskType.STORY',
  SUBTASK: 'taskType.SUBTASK',
};

export const CATEGORY_KEYS: Record<StatusCategory, TranslationKey> = {
  TODO: 'status.category.TODO',
  IN_PROGRESS: 'status.category.IN_PROGRESS',
  DONE: 'status.category.DONE',
};

export const LABEL_COLOR_KEYS: Record<LabelColor, TranslationKey> = {
  slate: 'labels.colorName.slate',
  blue: 'labels.colorName.blue',
  teal: 'labels.colorName.teal',
  green: 'labels.colorName.green',
  yellow: 'labels.colorName.yellow',
  orange: 'labels.colorName.orange',
  red: 'labels.colorName.red',
  purple: 'labels.colorName.purple',
};
