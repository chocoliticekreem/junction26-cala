export default function FixtureBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixture-banner font-mono" role="status" data-testid="fixture-banner">
      FIXTURE DATA — synthetic investors, not real
    </div>
  );
}
