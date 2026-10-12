import type { NextRequest } from 'next/server';

import { respond } from '@/server/http';
import { deviceList, lanAddresses, localHostName } from '@/server/store';

export async function GET(request: NextRequest) {
  return respond(() => ({
    now: Date.now(),
    port: request.nextUrl.port || '80',
    hostName: localHostName(),
    addresses: lanAddresses(),
    devices: deviceList(),
  }));
}
