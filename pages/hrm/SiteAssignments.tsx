import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { useModuleData } from '../../hooks/useModuleData';
import SiteAssignmentView from '../../components/hrm/assignment/SiteAssignmentView';

// Điều động công trường (H2): the server decides what each person may see and do.
const SiteAssignments: React.FC = () => {
  const { employees } = useApp();
  const [searchParams] = useSearchParams();
  useModuleData('hrm');
  const people = useMemo(() => employees
    .filter(employee => employee.status === 'Đang làm việc')
    .map(employee => ({ id: employee.id, fullName: employee.fullName, employeeCode: employee.employeeCode, title: employee.title }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')), [employees]);
  return <SiteAssignmentView people={people} initialSelectedId={searchParams.get('id')} />;
};

export default SiteAssignments;
