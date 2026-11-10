import tesseraIcon from '../../assets/tessera-icon.svg';

/** Tessera's own mark. Provider logos identify their panels, not the app. */
export function TesseraIcon({ size = 24, className }: { size?: number; className?: string }) {
  return <img src={tesseraIcon} width={size} height={size} className={className} alt="" aria-hidden="true" draggable={false} />;
}
