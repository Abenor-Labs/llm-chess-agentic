"use client";

import { useMemo } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";

interface BoardProps {
  id: string;
  fen: string;
  orientation?: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  checkSquare?: string | null;
  animate?: boolean;
  /** Makes the board playable for this color; called with a legal UCI move. */
  movable?: "white" | "black" | null;
  onMove?: (uci: string, fenAfter: string) => void;
}

const LAST_MOVE = { backgroundColor: "rgba(250, 204, 21, 0.45)" };
const CHECK = { background: "radial-gradient(circle, rgba(239,68,68,0.85) 0%, rgba(239,68,68,0.35) 45%, transparent 75%)" };

/** Board with last-move and check highlights; read-only unless `movable` is set. */
export function Board({ id, fen, orientation = "white", lastMove, checkSquare, animate = true, movable = null, onMove }: BoardProps) {
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      styles[lastMove.from] = LAST_MOVE;
      styles[lastMove.to] = LAST_MOVE;
    }
    if (checkSquare) styles[checkSquare] = { ...styles[checkSquare], ...CHECK };
    return styles;
  }, [lastMove, checkSquare]);

  return (
    <Chessboard
      options={{
        id,
        position: fen,
        boardOrientation: orientation,
        allowDragging: Boolean(movable && onMove),
        canDragPiece: ({ piece }) => Boolean(movable) && piece.pieceType[0] === movable![0],
        onPieceDrop: ({ sourceSquare, targetSquare }) => {
          if (!targetSquare || !onMove) return false;
          // shortcut: promotions always pick a queen; add a picker if anyone asks for underpromotion.
          try {
            const chess = new Chess(fen);
            const m = chess.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
            onMove(m.from + m.to + (m.promotion ?? ""), chess.fen());
            return true;
          } catch {
            return false; // illegal: the piece snaps back
          }
        },
        showAnimations: animate,
        animationDurationInMs: 250,
        squareStyles,
        lightSquareStyle: { backgroundColor: "#f0d9b5" },
        darkSquareStyle: { backgroundColor: "#b58863" },
        boardStyle: { borderRadius: "6px", overflow: "hidden" },
      }}
    />
  );
}
