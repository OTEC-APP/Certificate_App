export function Status({
  status
}) {
  const label = status === 'issued' ? 'Validated' : status === 'pending' ? 'Under Review' : status === 'revoked' ? 'Revoked' : status;
  return <span className={`status status-${status}`}>● {label}</span>;
}
export function CardHead({
  title,
  hint,
  action,
  onAction,
  tag
}) {
  return <div className="card-head"><h3>{title}</h3>{tag && <em>{tag}</em>}{hint && <small>{hint}</small>}{action && <button onClick={onAction}>{action}</button>}</div>;
}
export function Progress({
  label,
  value,
  total,
  color
}) {
  return <div className="progress-row"><div><b>{label}</b><span>{value} records</span></div><div className="progress"><i style={{
        width: `${value / total * 100}%`,
        background: color
      }} /></div></div>;
}
