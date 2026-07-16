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
  FolderTree,
  ThumbsUp,
  ThumbsDown
} from 'lucide-react';
import { ChatMessage, Keyword, AskAIResponse, KeywordSuggestion } from '@/types';

interface AIAssistantProps {
  keywords: Keyword[];
  /**
   * Keyword IDs used as context for /api/ask.
   * If provided, the component behaves as a controlled component.
   */
  selectedKeywordIds?: string[];
  onSelectedKeywordIdsChange?: (ids: string[]) => void;
  onSelectKeyword?: (keywordId: string) => void;
  onKeywordsCreated?: () => void; // Callback to refresh keywords list
}

export const AIAssistant: React.FC<AIAssistantProps> = ({
  keywords,
  selectedKeywordIds = [],
  onSelectedKeywordIdsChange,
  onSelectKeyword,
  onKeywordsCreated,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  // Human feedback per assistant message id (+1 / -1 once submitted)
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, 1 | -1>>({});
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [internalContextKeywords, setInternalContextKeywords] = useState<string[]>(selectedKeywordIds);
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

  const contextKeywords = onSelectedKeywordIdsChange ? selectedKeywordIds : internalContextKeywords;

  // Human feedback: thumbs up, or thumbs down with a correction. Corrections
  // become standing guidance for future answers and fine-tuning data.
  const sendFeedback = async (msg: ChatMessage, rating: 1 | -1, correction?: string) => {
    const idx = messages.findIndex((m) => m.id === msg.id);
    const question =
      [...messages.slice(0, Math.max(idx, 0))].reverse().find((m) => m.role === 'user')?.content ?? '';
    setFeedbackGiven((prev) => ({ ...prev, [msg.id]: rating }));
    setCorrectingId(null);
    setCorrectionText('');
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          answer: msg.content,
          rating,
          correction: correction?.trim() || undefined,
          context_keyword_ids: contextKeywords,
        }),
      });
    } catch (error) {
      console.error('Failed to send feedback:', error);
    }
  };

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
    const next = contextKeywords.includes(keywordId)
      ? contextKeywords.filter((id) => id !== keywordId)
      : [...contextKeywords, keywordId];

    if (onSelectedKeywordIdsChange) {
      onSelectedKeywordIdsChange(next);
    } else {
      setInternalContextKeywords(next);
    }
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
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">AI Assistant</h3>
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Powered by Ontology</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-xl transition-colors"
            title="Clear chat"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="px-5 py-3 border-b border-slate-100 bg-white shrink-0">
        <div className="flex gap-2 p-1 bg-slate-100/80 rounded-xl">
          <button
            onClick={() => setMode('ask')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              mode === 'ask'
                ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
            }`}
          >
            <Bot className="w-4 h-4" />
            Ask Questions
          </button>
          <button
            onClick={() => setMode('generate')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              mode === 'generate'
                ? 'bg-white text-purple-600 shadow-sm ring-1 ring-slate-200/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            Generate Concepts
          </button>
        </div>
      </div>

      {/* Context Keywords Selector (only for ask mode) */}
      {mode === 'ask' && (
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <FolderTree className="w-3.5 h-3.5 text-slate-400" />
            <p className="text-xs font-semibold text-slate-600">Active Context</p>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar pr-1">
            {keywords.slice(0, 15).map((kw) => (
              <button
                key={kw.id}
                onClick={() => toggleKeywordContext(kw.id)}
                className={`
                  px-2.5 py-1 text-xs font-medium rounded-lg border transition-all duration-200
                  ${contextKeywords.includes(kw.id)
                    ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }
                `}
              >
                {kw.title}
              </button>
            ))}
            {keywords.length === 0 && (
              <span className="text-xs text-slate-400 italic">No concepts available</span>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6 bg-slate-50/30">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center animate-in fade-in duration-500">
            {mode === 'ask' ? (
              <>
                <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-5 shadow-inner">
                  <Bot className="w-8 h-8 text-blue-500" />
                </div>
                <h4 className="text-lg font-bold text-slate-800 mb-2">
                  Ask your Ontology
                </h4>
                <p className="text-sm text-slate-500 mb-8 max-w-[280px] leading-relaxed">
                  I can answer questions using your concept definitions, relationships, and uploaded documents.
                </p>
                
                {/* Suggested Questions */}
                <div className="w-full max-w-sm space-y-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Suggested Questions</p>
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(q)}
                      className="w-full text-left px-4 py-3 bg-white border border-slate-200 hover:border-blue-300 hover:shadow-sm rounded-xl text-sm font-medium text-slate-600 hover:text-blue-600 transition-all duration-200 group flex items-center justify-between"
                    >
                      <span className="truncate pr-2">{q}</span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mb-5 shadow-inner">
                  <FolderTree className="w-8 h-8 text-purple-500" />
                </div>
                <h4 className="text-lg font-bold text-slate-800 mb-2">
                  Generate Concepts
                </h4>
                <p className="text-sm text-slate-500 mb-8 max-w-[280px] leading-relaxed">
                  Enter a topic and I'll suggest a structured hierarchy of concepts with definitions.
                </p>
                <div className="w-full max-w-sm space-y-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Suggested Topics</p>
                  {suggestedTopics.map((topic, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(topic)}
                      className="w-full text-left px-4 py-3 bg-white border border-slate-200 hover:border-purple-300 hover:shadow-sm rounded-xl text-sm font-medium text-slate-600 hover:text-purple-600 transition-all duration-200 group flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2 truncate pr-2">
                        <Wand2 className="w-4 h-4 text-slate-300 group-hover:text-purple-400 shrink-0" />
                        {topic}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-purple-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in slide-in-from-bottom-2 duration-300`}
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center shadow-sm mt-1 ${
                  msg.role === 'user' 
                    ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' 
                    : 'bg-white border border-slate-200 text-blue-600'
                }`}>
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                
                <div
                  className={`max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm px-5 py-3.5 shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-700 rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm'
                  }`}
                >
                  <div className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{msg.content}</div>
                  
                  {/* Sources */}
                  {msg.role === 'assistant' && msg.sources_json && msg.sources_json.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Sources Used</p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.sources_json.map((source, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              if (source.type !== 'keyword') return;
                              if (onSelectedKeywordIdsChange) {
                                toggleKeywordContext(source.id);
                                return;
                              }
                              onSelectKeyword?.(source.id);
                            }}
                            className={`
                              inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors
                              ${source.type === 'keyword'
                                ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100'
                                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
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

                  {/* Feedback: 👍 or 👎 + correction */}
                  {msg.role === 'assistant' && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100">
                      {feedbackGiven[msg.id] ? (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                          <Check className="w-3 h-3 text-emerald-500" />
                          Danke — die KI lernt daraus · Thanks, the AI learns from this
                        </span>
                      ) : correctingId === msg.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={correctionText}
                            onChange={(e) => setCorrectionText(e.target.value)}
                            placeholder="Wie wäre es richtig? · What should the answer be?"
                            rows={2}
                            autoFocus
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:ring-1 focus:ring-blue-400 resize-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => sendFeedback(msg, -1, correctionText)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                            >
                              Korrektur senden
                            </button>
                            <button
                              onClick={() => sendFeedback(msg, -1)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
                            >
                              Nur 👎 senden
                            </button>
                            <button
                              onClick={() => {
                                setCorrectingId(null);
                                setCorrectionText('');
                              }}
                              className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                            >
                              Abbrechen
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => sendFeedback(msg, 1)}
                            title="Hilfreich · Helpful"
                            className="p-1.5 rounded-lg text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setCorrectingId(msg.id);
                              setCorrectionText('');
                            }}
                            title="Falsch — korrigieren · Wrong, correct it"
                            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {/* Pending Suggestions Panel */}
            {pendingSuggestions && (
              <div className="bg-white border border-purple-200 rounded-2xl p-5 shadow-sm shadow-purple-500/5 animate-in slide-in-from-bottom-4 duration-500 ml-11">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">
                      <Wand2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800">Suggested Concepts</h4>
                      <p className="text-xs font-medium text-purple-600">
                        {selectedSuggestions.size} selected for creation
                      </p>
                    </div>
                  </div>
                </div>
                
                {suggestionExplanation && (
                  <div className="mb-5 p-3 bg-purple-50/50 rounded-xl border border-purple-100">
                    <p className="text-sm text-slate-600 leading-relaxed">{suggestionExplanation}</p>
                  </div>
                )}

                {/* Parent keyword selector */}
                <div className="mb-5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                    Attach to Parent Concept (Optional)
                  </label>
                  <select
                    value={parentKeywordId || ''}
                    onChange={(e) => setParentKeywordId(e.target.value || null)}
                    className="w-full px-4 py-2.5 text-sm font-medium border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-300 transition-all text-slate-700"
                  >
                    <option value="">Root level (no parent)</option>
                    {keywords.map((kw) => (
                      <option key={kw.id} value={kw.id}>{kw.title}</option>
                    ))}
                  </select>
                </div>

                {/* Suggestions list */}
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar pr-2 mb-5">
                  {pendingSuggestions?.map(kw => renderSuggestion(kw))}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 pt-4 border-t border-slate-100">
                  <button
                    onClick={handleCancelSuggestions}
                    disabled={isCreating}
                    className="px-4 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmKeywords}
                    disabled={isCreating || selectedSuggestions.size === 0}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-purple-600/20 transition-all active:scale-[0.98]"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Creating Concepts...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Create {selectedSuggestions.size} Concepts
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
            
            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-3 animate-in fade-in duration-300">
                <div className="flex-shrink-0 w-8 h-8 bg-white border border-slate-200 rounded-xl flex items-center justify-center shadow-sm mt-1">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span className="text-sm font-medium text-slate-500">
                      {mode === 'generate' ? 'Generating concepts...' : 'Thinking...'}
                    </span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} className="h-1" />
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-100 bg-white shrink-0">
        <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={mode === 'generate' ? 'Enter a topic to generate concepts...' : 'Ask a question...'}
            className="flex-1 max-h-32 min-h-[44px] px-3 py-2.5 bg-transparent border-none focus:ring-0 text-sm text-slate-700 placeholder-slate-400 resize-none custom-scrollbar"
            disabled={isLoading || isCreating}
            rows={1}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading || isCreating}
            className={`p-2.5 rounded-xl text-white shrink-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
              mode === 'generate'
                ? 'bg-purple-600 hover:bg-purple-700 shadow-sm shadow-purple-600/20'
                : 'bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-600/20'
            }`}
          >
            {mode === 'generate' ? <Wand2 className="w-5 h-5" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
        <div className="mt-2 text-center">
          <span className="text-[10px] font-medium text-slate-400">Press Enter to send, Shift+Enter for new line</span>
        </div>
      </form>
    </div>
  );
};

export default AIAssistant;
