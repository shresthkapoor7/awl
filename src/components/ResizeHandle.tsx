import { useRef } from "react";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  reversed?: boolean;
};

export function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
  reversed = false,
}: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const direction = reversed ? -1 : 1;
  const resize = (width: number) =>
    onChange(Math.max(min, Math.min(max, width)));

  return (
    <div
      className={`resize-handle ${reversed ? "left-edge" : "right-edge"}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: value };
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(
            drag.current.width + (event.clientX - drag.current.x) * direction,
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        if (event.key === "Home") resize(min);
        else if (event.key === "End") resize(max);
        else
          resize(value + (event.key === "ArrowRight" ? 16 : -16) * direction);
      }}
    />
  );
}
