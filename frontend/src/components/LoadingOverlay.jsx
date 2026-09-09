export default function LoadingOverlay({ message = 'Saving changes' }) {
  return (
    <div className="certtrack-loader" role="status" aria-live="polite" aria-label={message}>
      <div className="certtrack-loader-card">
        <span className="certtrack-loader-spinner" aria-hidden="true" />
        <div>
          <b>{message}</b>
          <small>Please wait a moment.</small>
        </div>
      </div>
    </div>
  )
}
