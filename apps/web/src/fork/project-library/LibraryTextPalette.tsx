import { useEffect, useRef } from "react";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Textarea } from "~/components/ui/textarea";
import { LibraryPaletteView } from "./LibraryPalette";

/** Longer briefs and continuation notes keep their line breaks inside the same palette. */
export function LibraryTextPalette({
  title,
  value,
  onChange,
  onBack,
  onClose,
}: {
  readonly title: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => editor.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <LibraryPaletteView
      title={title}
      placeholder={title}
      query=""
      onQueryChange={() => {}}
      onBack={onBack}
      onClose={onClose}
      readOnly
      filter={false}
      footerHints={
        <>
          <KbdGroup>
            <Kbd>Enter</Kbd>
            <span>New line</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd>Ctrl/⌘</Kbd>
            <Kbd>Enter</Kbd>
            <span>Done</span>
          </KbdGroup>
          <KbdGroup>
            <Kbd>Esc</Kbd>
            <span>Back</span>
          </KbdGroup>
        </>
      }
      items={[{ id: "keep-text", title: "Keep this text", select: onBack }]}
    >
      <div className="px-4 pb-2">
        <Textarea
          ref={editor}
          aria-label={title}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            event.stopPropagation();
            if (
              event.key === "Escape" ||
              (event.key === "Enter" && (event.ctrlKey || event.metaKey))
            ) {
              event.preventDefault();
              onBack();
            }
          }}
        />
      </div>
    </LibraryPaletteView>
  );
}
