export interface ActionBarProps {
  canDisplay: boolean;
  onDisplay: () => void;
  attachMode: boolean;
  canAttach: boolean;
  onAttach: () => void;
  onCancelAttach: () => void;
  isMyTurn: boolean;
  awaitDiscard: boolean;
  discardEnabled: boolean;
  isDeclare: boolean;
  onDiscard: () => void;
  awaitTake: boolean;
  onDrawStock: () => void;
  stockEmpty: boolean;
  onDeclareDead: () => void;
}

/** Contextual bottom action bar — only enables what client-side hints say is currently legal. */
export function ActionBar(props: ActionBarProps) {
  return (
    <div className="action-bar" style={{ display: "flex", gap: "0.5rem", padding: "0.5rem 0.75rem", flexWrap: "wrap" }}>
      <button type="button" className="btn" disabled={!props.canDisplay} onClick={props.onDisplay}>
        Display
      </button>

      {props.attachMode ? (
        <>
          <button type="button" className="btn btn-primary" disabled={!props.canAttach} onClick={props.onAttach}>
            Attach
          </button>
          <button type="button" className="btn btn-ghost" onClick={props.onCancelAttach}>
            Cancel attach
          </button>
        </>
      ) : null}

      {props.isMyTurn && props.awaitTake && (
        <>
          <button type="button" className="btn btn-primary" onClick={props.onDrawStock} disabled={props.stockEmpty}>
            Draw stock
          </button>
          {props.stockEmpty && (
            <button type="button" className="btn btn-danger" onClick={props.onDeclareDead}>
              Round is dead
            </button>
          )}
        </>
      )}

      {props.isMyTurn && props.awaitDiscard && (
        <button
          type="button"
          className={props.isDeclare ? "btn btn-primary" : "btn"}
          disabled={!props.discardEnabled}
          onClick={props.onDiscard}
          style={props.isDeclare ? { boxShadow: "0 0 0 3px rgba(242,183,5,0.6)" } : undefined}
        >
          {props.isDeclare ? "DECLARE!" : "Discard"}
        </button>
      )}
    </div>
  );
}
