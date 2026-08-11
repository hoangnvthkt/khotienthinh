import { describe, expect, it } from 'vitest';
import * as bookingService from '../vehicleBookingService';

const service = bookingService as typeof bookingService & {
  buildVehicleBookingParticipantPayload: (input: string) => Array<{
    participantName: string;
    isExternal: boolean;
  }>;
  getVehicleBookingPilotActions: (input: {
    bookingStatus: string;
    fulfillmentType?: string;
    handoverEvents?: string[];
    feedbackStatus?: string;
  }) => string[];
};

describe('vehicle booking pilot journeys', () => {
  it('maps one companion per non-empty line before submitting a draft', () => {
    expect(service.buildVehicleBookingParticipantPayload).toBeTypeOf('function');
    expect(service.buildVehicleBookingParticipantPayload(' Nguyễn Văn A \n\nTrần Thị B\n')).toEqual([
      { participantName: 'Nguyễn Văn A', isExternal: false },
      { participantName: 'Trần Thị B', isExternal: false },
    ]);
  });

  it('keeps the internal-with-driver journey on the trip execution path', () => {
    expect(service.getVehicleBookingPilotActions).toBeTypeOf('function');
    expect(service.getVehicleBookingPilotActions({
      bookingStatus: 'ASSIGNED',
      fulfillmentType: 'INTERNAL_WITH_DRIVER',
    })).toContain('EXECUTE_TRIP');
  });

  it('requires physical custody for self-drive and requester completion for external transport', () => {
    expect(service.getVehicleBookingPilotActions({
      bookingStatus: 'ASSIGNED',
      fulfillmentType: 'INTERNAL_SELF_DRIVE',
      handoverEvents: [],
    })).toContain('HANDOVER_OUTBOUND');
    expect(service.getVehicleBookingPilotActions({
      bookingStatus: 'ASSIGNED',
      fulfillmentType: 'EXTERNAL_TRANSPORT',
    })).toContain('COMPLETE_EXTERNAL');
  });

  it('opens feedback only after a completed journey with pending feedback', () => {
    expect(service.getVehicleBookingPilotActions({
      bookingStatus: 'COMPLETED',
      fulfillmentType: 'EXTERNAL_TRANSPORT',
      feedbackStatus: 'PENDING',
    })).toEqual(['SUBMIT_FEEDBACK']);
  });
});
