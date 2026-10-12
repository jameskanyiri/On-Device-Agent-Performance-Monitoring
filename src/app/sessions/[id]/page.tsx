import { SessionView } from '@/components/views/session';

export default async function Page(props: PageProps<'/sessions/[id]'>) {
  const { id } = await props.params;
  return <SessionView id={decodeURIComponent(id)} />;
}
