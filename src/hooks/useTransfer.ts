import { useSyncExternalStore } from 'react'
import type { TransferController, TransferSnapshot } from '../lib/transfer'

/** Subscribe a component to a TransferController's snapshot. */
export function useTransferSnapshot(
  controller: TransferController,
): TransferSnapshot {
  return useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.state,
  )
}
