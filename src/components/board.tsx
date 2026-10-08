"use client";

import { useMemo } from "react";
import { Chessboard } from "react-chessboard";

interface BoardProps {
  id: string;
  fen: string;
  orientation?: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  checkSquare?: string | null;
  animate?: boolean;
}

const LAST_MOVE = { backgroundColor: "rgba(250, 204, 21, 0.45)" };
const CHECK = { background: "radial-gradient(circle, rgba(239,68,68,0.85) 0%, rgba(239,68,68,0.35) 45%, transparent 75%)" };

/** Read-only board with last-move and check highlights. */
export function Board({ id, fen, orientation = "white", lastMove, checkSquare, animate = true }: BoardProps) {
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
        allowDragging: false,
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
