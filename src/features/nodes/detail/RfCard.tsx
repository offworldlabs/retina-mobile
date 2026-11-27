import type { OwnerNode } from '@/api';
import { Card, Row } from './Card';
import { DASH, formatPosition, formatSampleRate, measure } from './format';
import { formatMhz } from '@/features/nodes/model';

/** The node as configured: its true positions and every RF setting the owner's routes carry. */
export function RfCard({ node }: { node: OwnerNode }) {
  const { location, rf } = node;
  return (
    <Card title="RF Configuration">
      <Row label="Center Frequency" value={formatMhz(node.frequency)} />
      <Row label="Sample Rate" value={formatSampleRate(node.sample_rate)} />
      <Row
        label="RX Location"
        value={formatPosition(location.rx_lat, location.rx_lon, location.rx_alt_ft)}
      />
      <Row
        label="TX Location"
        value={formatPosition(location.tx_lat, location.tx_lon, location.tx_alt_ft)}
      />
      <Row label="TX Callsign" value={rf.tx_callsign || DASH} />
      <Row label="Beam Width" value={measure(rf.beam_width_deg, '°', 1)} />
      <Row label="Beam Azimuth" value={measure(rf.beam_azimuth_deg, '°', 1)} />
      <Row label="Max Range" value={measure(rf.max_range_km, 'km', 1)} />
      <Row label="CPI" value={measure(rf.cpi_s, 's', 3)} />
      <Row label="Delay Tolerance" value={measure(rf.delay_tolerance_us, 'µs', 2)} />
      <Row label="Doppler Tolerance" value={measure(rf.doppler_tolerance_hz, 'Hz', 2)} />
    </Card>
  );
}
