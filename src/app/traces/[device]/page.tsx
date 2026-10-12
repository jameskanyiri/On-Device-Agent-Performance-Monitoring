import { Suspense } from 'react';

import { DeviceView } from '@/components/views/device';

export default async function Page(props: PageProps<'/traces/[device]'>) {
  const { device } = await props.params;
  // DeviceView reads ?trace= (the open side panel), so it renders under Suspense.
  return (
    <Suspense>
      <DeviceView deviceId={decodeURIComponent(device)} />
    </Suspense>
  );
}
