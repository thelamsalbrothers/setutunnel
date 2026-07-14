import { useState } from 'react'
import type { FileInfo } from '../lib/transfer'
import { FileList } from './FileList'
import { AlertIcon } from './icons'
import { Button } from './ui'

/**
 * Consent gate (§4.7): nothing is written to disk until the receiver accepts,
 * after seeing the files and the SAS. Risky types require a second, deliberate
 * confirmation.
 */
export function ConsentCard({
  files,
  danger,
  onAccept,
  onDecline,
}: {
  files: FileInfo[]
  danger: string[]
  onAccept: () => void
  onDecline: () => void
}) {
  const risky = danger.length > 0
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <FileList files={files} />

      {risky && (
        <div className="rounded-md border border-destructive/40 bg-destructive/8 p-3.5 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertIcon className="h-4 w-4" />
            This file could be risky
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-destructive/90">
            {danger.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-foreground">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="h-4 w-4 accent-destructive"
              data-testid="risk-ack"
            />
            I know the sender and want this file anyway
          </label>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          variant="ghost"
          className="flex-1"
          onClick={() => {
            setSubmitted(true)
            onDecline()
          }}
          disabled={submitted}
          data-testid="decline"
        >
          Decline
        </Button>
        <Button
          variant={risky ? 'danger' : 'primary'}
          className="flex-1"
          onClick={() => {
            setSubmitted(true)
            onAccept()
          }}
          disabled={submitted || (risky && !acknowledged)}
          data-testid="accept"
        >
          {risky ? 'Accept anyway' : 'Accept & download'}
        </Button>
      </div>
    </div>
  )
}
