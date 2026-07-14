import QRCode from 'qrcode'

/**
 * Render a pairing URL as a QR data URL. Dark modules on a transparent ground
 * so it sits on our own white QR panel and scans reliably in either theme.
 */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: { dark: '#312e81ff', light: '#00000000' },
  })
}
