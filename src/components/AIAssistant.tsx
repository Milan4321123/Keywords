'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Loader2, 
  Bot, 
  User, 
  FileText, 
  Tag, 
  ChevronRight,
  Sparkles,
  RefreshCw,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Wand2,
  FolderTree
} from 'lucide-react';
import { ChatMessage, Keyword, AskAIResponse, KeywordSuggestion } from '@/types';

interface AIAssistantProps {
  keywords: Keyword[];
  selectedKeywordIds?: string[];
  onSelectKeyword?: (keywordId: string) => void;
  onKeywordsCreated?: () => void; // Callback to refresh keywords list
}

export const AIAssistant: React.FC<AIAssistantProps> = ({
  keywords,
  selectedKeywordIds = [],
  onSelectKeyword,
  onKeywordsCreated,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [contextKeywords, setContextKeywords] = useState<string[]>(selectedKeywordIds);
  const [mode, setMode] = useState<'ask' | 'generate'>('ask');
  const [pendingSuggestions, setPendingSuggestions] = useState<KeywordSuggestion[] | null>(null);
  const [suggestionExplanation, setSuggestionExplanation] = useState<string>('');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [parentKeywordId, setParentKeywordId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setContextKeywords(selectedKeywordIds);
  }, [selectedKeywordIds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (mode === 'generate') {
      await handleGenerateKeywords();
    } else {
      await handleAskQuestion();
    }
  };

  const handleAskQuestion = async () => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      session_id: 'current',
      role: 'user',
      content: input,
      sources_json: [],
      token_count: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: input,
          context_keyword_ids: contextKeywords,
          include_relations: true,
          include_assets: true,
        }),
      });

      if (!response.ok) throw new Error('Failed to get response');

      const data: AskAIResponse = await response.json();

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        session_id: 'current',
        role: 'assistant',
        content: data.answer,
        sources_json: data.sources,
        token_count: null,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error asking AI:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        session_id: 'current',
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your question. Please try again.',
        sources_json: [],
        token_count: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateKeywords = async () => {
    const topic = input;
    setInput('');
    setIsLoading(true);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      session_id: 'current',
      role: 'user',
      content: `🔧 Generate keywords for: "${topic}"`,
      sources_json: [],
      token_count: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await fetch('/api/generate-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          depth: 2,
          count: 5,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate keywords');

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setPendingSuggestions(data.keywords);
      setSuggestionExplanation(data.explanation);
      
      const allTitles = getAllKeywordTitles(data.keywords);
      setSelectedSuggestions(new Set(allTitles));
      setExpandedSuggestions(new Set(allTitles));

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        session_id: 'current',
        role: 'assistant',
        content: `I've generated keyword suggestions for "${topic}". Please review them below and confirm which ones you'd like to create.`,
        sources_json: [],
        token_count: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

    } catch (error) {
      console.error('Error generating keywords:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        session_id: 'current',
        role: 'assistant',
        content: 'Sorry, I encountered an error generating keyword suggestions. Please try again.',
        sources_json: [],
        token_count: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const getAllKeywordTitles = (kws: KeywordSuggestion[]): string[] => {
    const titles: string[] = [];
    const traverse = (list: KeywordSuggestion[]) => {
      for (const kw of list) {
        titles.push(kw.title);
        if (kw.children) traverse(kw.children);
      }
    };
    traverse(kws);
    return titles;
  };

  const toggleSuggestionSelection = (title: string) => {
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(title)) {
      newSelected.delete(title);
    } else {
      newSelected.add(title);
    }
    setSelectedSuggestions(newSelected);
  };

  const toggleSuggestionExpanded = (title: string) => {
    const newExpanded = new Set(expandedSuggestions);
    if (newExpanded.has(title)) {
      newExpanded.delete(title);
    } else {
      newExpanded.add(title);
    }
    setExpandedSuggestions(newExpanded);
  };

  const filterSelectedKeywords = (kws: KeywordSuggestion[]): KeywordSuggestion[] => {
    return kws
      .filter(kw => selectedSuggestions.has(kw.title))
      .map(kw => ({
        ...kw,
        children: kw.children ? filterSelectedKeywords(kw.children) : [],
      }));
  };

  const handleConfirmKeywords = async () => {
    if (!pendingSuggestions || selectedSuggestions.size === 0) return;

    setIsCreating(true);

    try {
      const keywordsToCreate = filterSelectedKeywords(pendingSuggestions);

      const response = await fetch('/api/generate-keywords', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: keywordsToCreate,
          parent_id: parentKeywordId,
        }),
      });

      if (!response.ok) throw new Error('Failed to create keywords');

      const data = await response.json();

      const successMessage: ChatMessage = {
        id: Date.now().toString(),
        session_id: 'current',
        role: 'assistant',
        content: `✅ Successfully created ${data.data.length} keywords! They are now available in your keyword tree.`,
        sources_json: [],
        token_count: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, successMessage]);

      setPendingSuggestions(null);
      setSuggestionExplanation('');
      setSelectedSuggestions(new Set());
      setParentKeywordId(null);

      onKeywordsCreated?.();

    } catch (error) {
      console.error('Error creating keywords:', error);
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        session_id: 'current',
        role: 'assistant',
        content: '❌ Failed to create keywords. Please try again.',
        sources_json: [],
        token_count: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelSuggestions = () => {
    setPendingSuggestions(null);
    setSuggestionExplanation('');
    setSelectedSuggestions(new Set());
    setParentKeywordId(null);

    const cancelMessage: ChatMessage = {
      id: Date.now().toString(),
      session_id: 'current',
      role: 'assistant',
      content: 'Keyword suggestions cancelled. Feel free to generate new ones anytime!',
      sources_json: [],
      token_count: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, cancelMessage]);
  };

  const toggleKeywordContext = (keywordId: string) => {
    setContextKeywords((prev) =>
      prev.includes(keywordId)
        ? prev.filter((id) => id !== keywordId)
        : [...prev, keywordId]
    );
  };

  const clearChat = () => {
    setMessages([]);
    setPendingSuggestions(null);
    setSuggestionExplanation('');
    setSelectedSuggestions(new Set());
  };

  const suggestedQuestions = [
    'What is the approval process for invoices?',
    'How are defects handled on site?',
    'What documents are required for a new project?',
    'Explain the relationship between trades and projects.',
  ];

  const suggestedTopics = [
    'Construction Project Management',
    'Invoice Processing Workflow',
    'Quality Control Procedures',
    'Site Safety Protocols',
  ];

  const renderSuggestion = (kw: KeywordSuggestion, depth: number = 0) => {
    const hasChildren = kw.children && kw.children.length > 0;
    const isExpanded = expandedSuggestions.has(kw.title);
    const isSelected = selectedSuggestions.has(kw.title);

    return (
      <div key={kw.title} className="border-l-2 border-gray-200" style={{ marginLeft: depth > 0 ? '12px' : '0' }}>
        <div className={`p-3 ${isSelected ? 'bg-blue-50' : 'bg-gray-50'} rounded-r-lg mb-1`}>
          <div className="flex items-start gap-2">
            <button
              onClick={() => toggleSuggestionSelection(kw.title)}
              className={`mt-0.5 w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center ${
                isSelected 
                  ? 'bg-blue-500 border-blue-500 text-white' 
                  : 'border-gray-300 bg-white'
              }`}
            >
              {isSelected && <Check className="w-3 h-3" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>
                  {kw.title}
                </span>
                {hasChildren && (
                  <button
                    onClick={() => toggleSuggestionExpanded(kw.title)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-1">{kw.definition}</p>
              {kw.examples && kw.examples.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  Examples: {kw.examples.join(', ')}
                </p>
              )}
            </div>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="mt-1">
            {kw.children!.map(child => renderSuggestion(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-500 rounded-lg">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-800">AI Assistant</h3>
            <p className="text-xs text-gray-500">Ask questions or generate keywords</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            title="Clear chat"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="px-4 py-2 border-b bg-gray-50">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('ask')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'ask'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Bot className="w-4 h-4" />
            Ask Questions
          </button>
          <button
            onClick={() => setMode('generate')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'generate'
                ? 'bg-purple-500 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            Generate Keywords
          </button>
        </div>
      </div>

      {/* Context Keywords Selector (only for ask mode) */}
      {mode === 'ask' && (
        <div className="px-4 py-2 border-b bg-gray-50">
          <p className="text-xs text-gray-500 mb-2">Context (AI will focus on these topics):</p>
          <div className="flex flex-wrap gap-1">
            {keywords.slice(0, 10).map((kw) => (
              <button
                key={kw.id}
                onClick={() => toggleKeywordContext(kw.id)}
                className={`
                  px-2 py-1 text-xs rounded-full border transition-colors
                  ${contextKeywords.includes(kw.id)
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }
                `}
              >
                {kw.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            {mode === 'ask' ? (
              <>
                <Bot className="w-12 h-12 text-gray-300 mb-4" />
                <h4 className="font-medium text-gray-600 mb-2">
                  Ask me anything about your company knowledge
                </h4>
                <p className="text-sm text-gray-400 mb-6 max-w-md">
                  I can answer questions using your keyword definitions, relationships, and uploaded documents.
                </p>
                
                {/* Suggested Questions */}
                <div className="w-full max-w-md space-y-2">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Try asking:</p>
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(q)}
                      className="w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm text-gray-600 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4 inline mr-2 text-gray-400" />
                      {q}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <FolderTree className="w-12 h-12 text-purple-300 mb-4" />
                <h4 className="font-medium text-gray-600 mb-2">
                  Generate Keywords with AI
                </h4>
                <p className="text-sm text-gray-400 mb-6 max-w-md">
                  Enter a topic and I'll suggest a structured hierarchy of keywords with definitions. You can review and confirm before creating them.
                </p>
                <div className="w-full max-w-md space-y-2">
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Try generating for:</p>
                  {suggestedTopics.map((topic, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(topic)}
                      className="w-full text-left px-4 py-3 bg-purple-50 hover:bg-purple-100 rounded-lg text-sm text-purple-600 transition-colors"
                    >
                      <Wand2 className="w-4 h-4 inline mr-2 text-purple-400" />
                      {topic}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] ${
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-2'
                      : 'bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  
                  {/* Sources */}
                  {msg.role === 'assistant' && msg.sources_json.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-500 mb-2">Sources:</p>
                      <div className="flex flex-wrap gap-1">
                        {msg.sources_json.map((source, i) => (
                          <button
                            key={i}
                            onClick={() => source.type === 'keyword' && onSelectKeyword?.(source.id)}
                            className={`
                              inline-flex items-center gap-1 px-2 py-1 text-xs rounded
                              ${source.type === 'keyword'
                                ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                : 'bg-gray-50 text-gray-600'
                              }
                            `}
                          >
                            {source.type === 'keyword' ? (
                              <Tag className="w-3 h-3" />
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            {source.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))}
            
            {/* Pending Suggestions Panel */}
            {pendingSuggestions && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wand2 className="w-5 h-5 text-purple-600" />
                  <h4 className="font-semibold text-purple-800">Suggested Keywords</h4>
                  <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
                    {selectedSuggestions.size} selected
                  </span>
                </div>
                
                {suggestionExplanation && (
                  <p className="text-sm text-purple-700 mb-3">{suggestionExplanation}</p>
                )}

                {/* Parent keyword selector */}
                <div className="mb-3">
                  <label className="text-xs text-purple-600 block mb-1">
                    Create under parent (optional):
                  </label>
                  <select
                    value={parentKeywordId || ''}
                    onChange={(e) => setParentKeywordId(e.target.value || null)}
                    className="w-full px-3 py-2 text-sm border border-purple-200 rounded-lg bg-white"
                  >
                    <option value="">Root level (no parent)</option>
                    {keywords.map((kw) => (
                      <option key={kw.id} value={kw.id}>{kw.title}</option>
                    ))}
                  </select>
                </div>

                {/* Suggestions list */}
                <div className="space-y-1 max-h-60 overflow-auto mb-4">
                  {pendingSuggestions.map(kw => renderSuggestion(kw))}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmKeywords}
                    disabled={isCreating || selectedSuggestions.size === 0}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Create {selectedSuggestions.size} Keywords
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleCancelSuggestions}
                    disabled={isCreating}
                    className="px-4 py-2 text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                    <span className="text-sm text-gray-500">
                      {mode === 'generate' ? 'Generating keywords...' : 'Thinking...'}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mode === 'generate' ? 'Enter a topic to generate keywords...' : 'Ask a question...'}
            className={`flex-1 px-4 py-2 border rounded-xl focus:ring-2 focus:border-transparent ${
              mode === 'generate' 
                ? 'focus:ring-purple-500' 
                : 'focus:ring-blue-500'
            }`}
            disabled={isLoading || isCreating}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || isCreating}
            className={`px-4 py-2 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === 'generate'
                ? 'bg-purple-500 hover:bg-purple-600'
                : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {mode === 'generate' ? <Wand2 className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AIAssistant;
