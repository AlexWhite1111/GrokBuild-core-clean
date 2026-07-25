/**
 * DataTransfer.files is a live, event-scoped FileList. Snapshot File objects
 * synchronously so the Shell bridge never receives an emptied list later.
 */
export function snapshotDroppedFiles(transfer: DataTransfer): File[] {
  const itemFiles = Array.from(transfer.items || []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
  return itemFiles.length ? itemFiles : Array.from(transfer.files || []);
}
