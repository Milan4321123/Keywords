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
          relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
          transition-all duration-200
          ${isDragging 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
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
        
        <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
        
        <p className="text-sm font-medium text-gray-700">
          {isDragging ? 'Drop files here' : 'Drop files or click to upload'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          PDF, Images, Excel, Word, Text files
        </p>
      </div>

      {/* Uploading Files */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          {uploadingFiles.map((upload) => (
            <div
              key={upload.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex-shrink-0">
                {getFileIcon(getFileType(upload.file.type))}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{upload.file.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  {upload.status === 'uploading' && (
                    <>
                      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 transition-all duration-200"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{upload.progress}%</span>
                    </>
                  )}
                  {upload.status === 'processing' && (
                    <span className="flex items-center gap-1 text-xs text-amber-600">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Processing...
                    </span>
                  )}
                  {upload.status === 'done' && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle className="w-3 h-3" />
                      Uploaded
                    </span>
                  )}
                  {upload.status === 'error' && (
                    <span className="flex items-center gap-1 text-xs text-red-600">
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
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700">
            Attached Files ({existingAssets.length})
          </h4>
          <div className="grid gap-2">
            {existingAssets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-3 p-3 bg-white border rounded-lg hover:border-gray-300 transition-colors"
              >
                <div className="flex-shrink-0">
                  {asset.thumbnail_url ? (
                    <img
                      src={asset.thumbnail_url}
                      alt={asset.file_name}
                      className="w-10 h-10 object-cover rounded"
                    />
                  ) : (
                    getFileIcon(asset.file_type)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{asset.file_name}</p>
                  <p className="text-xs text-gray-500">
                    {formatFileSize(asset.file_size)}
                    {asset.processed && ' • Processed'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onViewAsset(asset)}
                    className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg"
                    title="View"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onRemove(asset.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
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
