import type { NextRequest } from 'next/server';

import { respond } from '@/server/http';
import { deviceList, lanAddresses, localHostName, RETENTION_DAYS } from '@/server/store';

export async function GET(request: NextRequest) {
  return respond(() => ({
    now: Date.now(),
    port: request.nextUrl.port || '80',
    hostName: localHostName(),
    retentionDays: RETENTION_DAYS,
    addresses: lanAddresses(),
    devices: deviceList(),
  }));
}
