import { useEffect, useRef, useState } from 'react';

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

export function useFileDrop({ active, onDrop }: { active: boolean; onDrop: (files: File[]) => void }): boolean {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const latest = useRef({ active, onDrop });

  useEffect(() => {
    latest.current = { active, onDrop };
  });

  useEffect(() => {
    const settle = () => {
      depth.current = 0;
      setOver(false);
    };

    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setOver(true);
    };

    const move = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = latest.current.active ? 'copy' : 'none';
    };

    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current -= 1;
      if (depth.current <= 0) settle();
    };

    const release = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      settle();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (latest.current.active && files.length > 0) latest.current.onDrop(files);
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', move);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', release);
    window.addEventListener('dragend', settle);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', move);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', release);
      window.removeEventListener('dragend', settle);
    };
  }, []);

  return over;
}
