import { Suspense } from 'react';

import { SessionView } from '@/components/views/session';

export default async function Page(props: PageProps<'/sessions/[id]'>) {
  const { id } = await props.params;
  // SessionView reads ?run= (the open side panel), so it renders under Suspense.
  return (
    <Suspense>
      <SessionView id={decodeURIComponent(id)} />
    </Suspense>
  );
}
