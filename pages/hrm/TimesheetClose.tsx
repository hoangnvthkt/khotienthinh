import React from 'react';
import { useSearchParams } from 'react-router-dom';
import TimesheetCloseView from '../../components/hrm/timesheet/TimesheetCloseView';

// Chốt công tháng (H4): HR reviews, HR Manage approves; employees see their own month here.
const TimesheetClose: React.FC = () => {
  const [searchParams] = useSearchParams();
  const year = Number(searchParams.get('year')) || undefined;
  const month = Number(searchParams.get('month')) || undefined;
  return <TimesheetCloseView initialYear={year} initialMonth={month} />;
};

export default TimesheetClose;
