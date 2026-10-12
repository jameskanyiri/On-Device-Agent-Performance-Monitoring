import { RunView } from '@/components/views/trace';

export default async function Page(props: PageProps<'/sessions/[id]/runs/[job]'>) {
  const { id, job } = await props.params;
  return <RunView sessionId={decodeURIComponent(id)} jobId={decodeURIComponent(job)} />;
}
