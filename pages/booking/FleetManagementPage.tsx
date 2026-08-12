import React from 'react';
import {
  fetchFleetVehicleCandidates,
  fetchVehicleDriverAuthorizationCandidates,
} from '../../lib/vehicleBookingService';
import FleetVehiclesManagement from './FleetVehiclesManagement';
import FleetDriversManagement from './FleetDriversManagement';
import FleetSettingsManagement from './FleetSettingsManagement';

type FleetManagementSection = 'VEHICLES' | 'DRIVERS' | 'SETTINGS';

const FleetManagementPage: React.FC<{ section: FleetManagementSection }> = ({ section }) => {
  if (section === 'VEHICLES') {
    return <FleetVehiclesManagement fetchCandidates={fetchFleetVehicleCandidates} />;
  }
  if (section === 'DRIVERS') {
    return <FleetDriversManagement fetchCandidates={fetchVehicleDriverAuthorizationCandidates} />;
  }
  return <FleetSettingsManagement />;
};

export default FleetManagementPage;
