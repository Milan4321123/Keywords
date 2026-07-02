'use client';

import React, { useState, useRef, useCallback } from 'react';
import { 
  Upload, 
  File, 
  FileText, 
  Image, 
  Table, 
  X, 
  Loader2,
  CheckCircle,
  AlertCircle,
  Eye,
  Trash2
} from 'lucide-react';
import { Asset, AssetType } from '@/types';

interface FileUploadProps {
  keywordId: string;
  existingAssets: Asset[];
  onUpload: (files: File[]) => Promise<void>;
  onRemove: (assetId: string) => void;
  onViewAsset: (asset: Asset) => void;
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'processing' | 'done' | 'error';
  error?: string;
}

const getFileType = (mimeType: string): AssetType => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'excel';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'word';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('text/')) return 'text';
  return 'other';
};

const getFileIcon = (type: AssetType) => {
  switch (type) {
    case 'image':
      return <Image className="w-8 h-8 text-green-500" />;
    case 'pdf':
      return <FileText className="w-8 h-8 text-red-500" />;
    case 'excel':
      return <Table className="w-8 h-8 text-green-600" />;
    case 'word':
      return <FileText className="w-8 h-8 text-blue-500" />;
    default:
      return <File className="w-8 h-8 text-gray-500" />;
  }
};

const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FileUpload: React.FC<FileUploadProps> = ({
  keywordId,
  existingAssets,
  onUpload,
  onRemove,
  onViewAsset,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFiles = async (files: File[]) => {
    // Create upload entries
    const newUploads: UploadingFile[] = files.map((file) => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      progress: 0,
      status: 'uploading',
    }));

    setUploadingFiles((prev) => [...prev, ...newUploads]);

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUploadingFiles((prev) =>
          prev.map((u) =>
            u.status === 'uploading' && u.progress < 90
              ? { ...u, progress: u.progress + 10 }
              : u
          )
        );
      }, 200);

      await onUpload(files);

      clearInterval(progressInterval);

      // Mark all as done
      setUploadingFiles((prev) =>
        prev.map((u) =>
          newUploads.some((n) => n.id === u.id)
            ? { ...u, progress: 100, status: 'done' }
            : u
        )
      );

      // Remove completed uploads after a delay
      setTimeout(() => {
        setUploadingFiles((prev) =>
          prev.filter((u) => !newUploads.some((n) => n.id === u.id))
        );
      }, 2000);
    } catch (error) {
      // Mark as error
      setUploadingFiles((prev) =>
        prev.map((u) =>
          newUploads.some((n) => n.id === u.id)
            ? { ...u, status: 'error', error: 'Upload failed' }
            : u
        )
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer
          transition-all duration-200 group
          ${isDragging 
            ? 'border-blue-400 bg-blue-50/50 shadow-inner' 
            : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50/50 bg-slate-50/30'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.txt"
        />
        
        <div className={`w-12 h-12 mx-auto mb-4 rounded-xl flex items-center justify-center transition-colors ${
          isDragging ? 'bg-blue-100 text-blue-600' : 'bg-white shadow-sm text-slate-400 group-hover:text-blue-500 group-hover:bg-blue-50'
        }`}>
          <Upload className="w-6 h-6" />
        </div>
        
        <p className="text-sm font-bold text-slate-700 mb-1">
          {isDragging ? 'Drop files here' : 'Click or drag files to upload'}
        </p>
        <p className="text-xs font-medium text-slate-500">
          PDF, Images, Excel, Word, Text files
        </p>
      </div>

      {/* Uploading Files */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2 animate-in fade-in duration-300">
          {uploadingFiles.map((upload) => (
            <div
              key={upload.id}
              className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl shadow-sm"
            >
              <div className="flex-shrink-0 w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center">
                {getFileIcon(getFileType(upload.file.type))}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-700 truncate">{upload.file.name}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {upload.status === 'uploading' && (
                    <>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-200"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500 w-8">{upload.progress}%</span>
                    </>
                  )}
                  {upload.status === 'processing' && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Processing...
                    </span>
                  )}
                  {upload.status === 'done' && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-md">
                      <CheckCircle className="w-3 h-3" />
                      Uploaded
                    </span>
                  )}
                  {upload.status === 'error' && (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-md">
                      <AlertCircle className="w-3 h-3" />
                      {upload.error}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Existing Assets */}
      {existingAssets.length > 0 && (
        <div className="space-y-3 animate-in fade-in duration-300">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Attached Files ({existingAssets.length})
          </h4>
          <div className="grid gap-2">
            {existingAssets.map((asset) => (
              <div
                key={asset.id}
                className="group flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all duration-200"
              >
                <div className="flex-shrink-0 w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center overflow-hidden">
                  {asset.thumbnail_url ? (
                    <img
                      src={asset.thumbnail_url}
                      alt={asset.file_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    getFileIcon(asset.file_type)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-700 truncate group-hover:text-blue-600 transition-colors">{asset.file_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-medium text-slate-500">
                      {formatFileSize(asset.file_size)}
                    </span>
                    {asset.processed && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-slate-300" />
                        <span className="text-[10px] font-bold text-green-600 uppercase tracking-wider bg-green-50 px-1.5 py-0.5 rounded">Processed</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onViewAsset(asset)}
                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="View"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onRemove(asset.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
