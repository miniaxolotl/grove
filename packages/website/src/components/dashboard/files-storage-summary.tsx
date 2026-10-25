"use client";
import { ChevronDown, HardDrive } from "lucide-react";
import type { FileStorage } from "@lib/shared/files";

export function fileBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const unit = value < 1024 ** 2 ? 1 : value < 1024 ** 3 ? 2 : 3;
  return `${(value / 1024 ** unit).toLocaleString("en", { maximumFractionDigits: 1 })} ${["B", "KiB", "MiB", "GiB"][unit]}`;
}
export function FilesStorageSummary({ usage }: { usage: FileStorage }) {
  return (
    <details className="files-storage">
      <summary>
        <HardDrive size={18} aria-hidden="true" />
        <span>
          <strong>Upload storage</strong>
          <span>
            {usage.fileCount} accessible{" "}
            {usage.fileCount === 1 ? "upload" : "uploads"}
            {usage.stagingBytes
              ? ` · ${fileBytes(usage.stagingBytes)} temporary`
              : ""}
          </span>
        </span>
        <span className="files-storage-value">
          {fileBytes(usage.budgetBytes)}{" "}
          <span>of {fileBytes(usage.byteLimit)}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="files-storage-detail">
        <dl>
          <div>
            <dt>Retained upload budget</dt>
            <dd>
              {fileBytes(usage.budgetBytes)}{" "}
              <span>of {fileBytes(usage.byteLimit)}</span>
            </dd>
          </div>
          <div>
            <dt>Temporary staging</dt>
            <dd>
              {fileBytes(usage.stagingBytes)}{" "}
              <span>of {fileBytes(usage.stagingLimit)}</span>
            </dd>
          </div>
          <div>
            <dt>Available originals</dt>
            <dd>
              {fileBytes(usage.visibleBytes)}{" "}
              <span>in authorized downloads</span>
            </dd>
          </div>
        </dl>
        <meter
          aria-label="Retained upload budget"
          value={usage.budgetBytes}
          max={usage.byteLimit}
        />
        <p>
          <strong>
            Removing a file or deleting a note doesn’t free retained storage.
          </strong>{" "}
          The retained budget includes private originals and uncertain or
          repeated writes, not just the files listed here.
        </p>
        <p>
          {usage.attempts.toLocaleString()} of{" "}
          {usage.attemptLimit.toLocaleString()} upload attempts used. Unaccepted
          document uploads expire after 24 hours; staging is released after
          cleanup. Read-aloud audio and export archives are separate temporary
          data.
        </p>
      </div>
    </details>
  );
}
