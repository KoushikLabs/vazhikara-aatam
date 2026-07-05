export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      title={connected ? "connected" : "disconnected"}
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: connected ? "#2ecc71" : "#999",
        flexShrink: 0,
      }}
    />
  );
}
