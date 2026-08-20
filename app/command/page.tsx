import type { Metadata } from 'next'
import './console.css'
import { Console } from '@/components/command/console'

export const metadata: Metadata = {
  title: 'CRME Command Center — Project NEXT',
  description:
    'Live operations console for the Cultural Response & Moment Engine: five-agent orchestration, refusal gates, human sign-off and the decision record store.',
}

/** The console is fully client-driven; this shell just mounts it. */
export default function CommandPage() {
  return <Console />
}
