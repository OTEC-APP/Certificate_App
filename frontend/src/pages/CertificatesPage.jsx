import { CardHead, Status } from '../components/UI';
import { categoryFor, initials, formatDate } from '../utils';
export default function CertificatesPage({
  certificates,
  filter,
  setFilter,
  onStatus
}) {
  return <section className="proto-card"><CardHead title="Employees & certifications" hint={`${certificates.length} records`} /><div className="table-filter"><span>Filter by status</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All certificates</option><option value="issued">Validated</option><option value="pending">Under Review</option><option value="revoked">Revoked</option></select></div><div className="table-responsive"><table className="proto-table"><thead><tr><th>Recipient</th><th>Certification</th><th>Certificate ID</th><th>Completion date</th><th>Status</th><th /></tr></thead><tbody>{certificates.map(item => <tr key={item.id}><td><div className="person"><span style={{
                  background: categoryFor(item.course_name)[1]
                }}>{initials(item.recipient_name)}</span><div><b>{item.recipient_name}</b><small>{item.email}</small></div></div></td><td><b>{item.course_name}</b></td><td><code>{item.certificate_number}</code></td><td>{formatDate(item.issued_date)}</td><td><Status status={item.status} /></td><td><select value={item.status} onChange={e => onStatus(item.id, e.target.value)}><option value="issued">Validated</option><option value="pending">Under Review</option><option value="revoked">Revoked</option></select></td></tr>)}</tbody></table></div></section>;
}
