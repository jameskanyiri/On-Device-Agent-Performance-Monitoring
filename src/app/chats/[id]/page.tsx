import { ChatTraceView } from '@/components/views/trace';

export default async function Page(props: PageProps<'/chats/[id]'>) {
  const { id } = await props.params;
  return <ChatTraceView traceId={decodeURIComponent(id)} />;
}
