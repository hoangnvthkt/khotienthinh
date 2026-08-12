import type { FulfillmentType } from './vehicleBooking';

export type VehicleBookingReportingPeriod = {
  fromAt: string;
  toAt: string;
};

export type VehicleBookingReportPreset = 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_QUARTER';

export interface VehicleBookingAnalytics {
  period: VehicleBookingReportingPeriod & { timeZone: 'Asia/Ho_Chi_Minh' };
  scope: {
    departmentId: string | null;
    capacityDenominator: 'CURRENT_ACTIVE_COMPANY_FLEET';
  };
  kpis: {
    completedTrips: number;
    onTimeEligibleTrips: number;
    onTimeTrips: number;
    onTimeRate: number | null;
    submittedBookings: number;
    lateCancelledBookings: number;
    lateCancellationRate: number | null;
    usedVehicleMinutes: number;
    availableVehicleMinutes: number;
    vehicleUtilizationRate: number | null;
  };
  distanceByVehicle: Array<{
    vehicleAssetId: string;
    vehicleCode: string;
    vehicleName: string;
    distanceKm: number;
    tripCount: number;
  }>;
  fulfillmentBreakdown: Array<{
    fulfillmentType: FulfillmentType;
    tripCount: number;
  }>;
  externalCostByDepartment: Array<{
    departmentId: string | null;
    departmentName: string;
    actualCost: number;
    tripCount: number;
  }>;
}

export interface VehicleBookingAnalyticsExportRow {
  bookingId: string;
  bookingCode: string;
  departmentId: string | null;
  departmentName: string;
  requestedPickupAt: string;
  actualPickupAt: string | null;
  actualReturnAt: string | null;
  fulfillmentType: FulfillmentType | null;
  vehicleCode: string | null;
  vehicleName: string | null;
  distanceKm: number | null;
  externalActualCost: number | null;
  status: string;
  closeReason: string | null;
  isOnTime: boolean | null;
}

export type VehicleBookingIssueStatus = 'PENDING' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';

export interface VehicleBookingSensitiveIssue {
  id: string;
  bookingId: string;
  bookingCode: string;
  reporterUserId: string;
  reporterName: string;
  departmentName: string | null;
  issueCategory: string;
  comment: string;
  rating: number | null;
  resolutionStatus: VehicleBookingIssueStatus;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface VehicleBookingIssuePage {
  items: VehicleBookingSensitiveIssue[];
  nextCursor: { createdAt: string; id: string } | null;
}
