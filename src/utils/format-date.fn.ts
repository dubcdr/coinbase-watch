import { format } from 'date-fns';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const formatDateForLog = (date: Date): string => {
  return format(date, 'd-M-yyyy');
};
