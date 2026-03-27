/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { GenogramData } from './types';
import { SYSTEM_PROMPT } from './constants';
import { GenogramCanvas, GenogramCanvasRef } from './components/GenogramCanvas';
import { 
  Users, 
  Send, 
  Loader2, 
  History, 
  AlertCircle, 
  Heart, 
  Info,
  Download,
  Share2,
  Edit3,
  Target,
  Upload,
  X,
  Copy,
  Check,
  Maximize
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeData(result: GenogramData): GenogramData {
  if (!result.relationships) result.relationships = [];
  if (!result.members) result.members = [];

  const indexMember = result.members.find(m => m.isIndexMember) || result.members[0];
  if (indexMember) {
    const parentLinks = result.relationships.filter(r => r.type === 'parent-child' && r.to === indexMember.id);
    const parentIds = parentLinks.map(r => r.from);

    if (parentIds.length > 0) {
      const siblingKeywords = ['누나', '형', '동생', '언니', '오빠', '남매', '자매', '형제', '첫째', '둘째', '셋째', '막내'];
      const nonSiblingKeywords = ['남편', '배우자', '아내', '부인', '처', '딸', '아들', '자녀', '조카', '며느리', '사위'];
      
      result.members.forEach(m => {
        if (m.id !== indexMember.id) {
          const hasSiblingKeyword = siblingKeywords.some(kw => m.name.includes(kw) || (m.healthText && m.healthText.includes(kw)));
          const hasNonSiblingKeyword = nonSiblingKeywords.some(kw => m.name.includes(kw));
          
          if (hasSiblingKeyword && !hasNonSiblingKeyword) {
            const hasParents = result.relationships.some(r => r.type === 'parent-child' && r.to === m.id);
            if (!hasParents) {
              parentIds.forEach(parentId => {
                const linkExists = result.relationships.some(r => r.type === 'parent-child' && r.from === parentId && r.to === m.id);
                if (!linkExists) {
                  result.relationships.push({
                    from: parentId,
                    to: m.id,
                    type: 'parent-child'
                  });
                }
              });
            }
          }
        }
      });
    }
  }
  return result;
}

export default function App() {
  const [input, setInput] = useState('');
  const [modifyInput, setModifyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [modifying, setModifying] = useState(false);
  const [loadingGoals, setLoadingGoals] = useState(false);
  const [interventionGoals, setInterventionGoals] = useState<string | null>(null);
  const [data, setData] = useState<GenogramData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [copiedAnalysis, setCopiedAnalysis] = useState(false);
  const [copiedGoals, setCopiedGoals] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<GenogramCanvasRef>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingFile(true);
    setError(null);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const base64Data = reader.result?.toString().split(',')[1];
          if (!base64Data) throw new Error("Failed to read file");

          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: {
              parts: [
                {
                  inlineData: {
                    data: base64Data,
                    mimeType: file.type,
                  }
                },
                {
                  text: "이 문서에서 가족 히스토리(가족 구성원, 나이, 건강 상태, 관계 등)를 추출해서 요약해줘. CT/내담자의 실명은 제외하고 'CT' 또는 익명으로 처리해줘."
                }
              ]
            }
          });

          if (response.text) {
            setInput(prev => prev ? prev + '\n\n' + response.text : response.text);
          }
        } catch (err) {
          console.error(err);
          setError('파일을 분석하는 중 오류가 발생했습니다.');
        } finally {
          setLoadingFile(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        throw new Error("Failed to read file");
      };
    } catch (err) {
      console.error(err);
      setError('파일을 처리하는 중 오류가 발생했습니다.');
      setLoadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const analyzeFamily = async () => {
    if (!input.trim()) return;
    
    setLoading(true);
    setError(null);
    setInterventionGoals(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: input,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              members: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name: { type: Type.STRING },
                    gender: { type: Type.STRING },
                    age: { type: Type.NUMBER },
                    occupation: { type: Type.STRING },
                    health: { type: Type.STRING },
                    healthStatus: { type: Type.STRING },
                    healthText: { type: Type.STRING },
                    deceased: { type: Type.BOOLEAN },
                    deathYear: { type: Type.STRING },
                    isIndexMember: { type: Type.BOOLEAN },
                    isAdopted: { type: Type.BOOLEAN },
                    nationality: { type: Type.STRING },
                    isLivingTogether: { type: Type.BOOLEAN },
                    birthOrder: { type: Type.NUMBER }
                  },
                  required: ["id", "name", "gender", "deceased"]
                }
              },
              relationships: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    from: { type: Type.STRING },
                    to: { type: Type.STRING },
                    type: { type: Type.STRING },
                    emotionalType: { type: Type.STRING },
                    twinType: { type: Type.STRING },
                    marriageYear: { type: Type.STRING },
                    divorceYear: { type: Type.STRING }
                  },
                  required: ["from", "to", "type"]
                }
              },
              analysis: { type: Type.STRING }
            },
            required: ["members", "relationships", "analysis"]
          }
        }
      });

      const text = response.text || '{}';
      const cleanText = text.replace(/^```json\n?|```$/gm, '').trim();
      let result = JSON.parse(cleanText) as GenogramData;
      
      result = normalizeData(result);
      
      setData(result);
    } catch (err) {
      console.error(err);
      setError('가족 정보를 분석하는 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleModify = async () => {
    if (!modifyInput.trim() || !data) return;
    
    setModifying(true);
    setError(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const modifyPrompt = `
현재 가계도 데이터:
${JSON.stringify(data, null, 2)}

사용자의 수정 요청:
"${modifyInput}"

위의 수정 요청을 반영하여 기존 가계도 데이터를 업데이트해 주세요.
주의사항:
1. 사망, 유산, 질병 등의 상태 변화가 있다면 반드시 해당 속성(deceased, health, healthStatus 등)을 정확히 업데이트하세요. (예: 사망 시 deceased: true 로 변경)
2. 동일한 JSON 형식으로 전체 데이터를 반환해야 합니다.
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: modifyPrompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              members: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name: { type: Type.STRING },
                    gender: { type: Type.STRING },
                    age: { type: Type.NUMBER },
                    occupation: { type: Type.STRING },
                    health: { type: Type.STRING },
                    healthStatus: { type: Type.STRING },
                    healthText: { type: Type.STRING },
                    deceased: { type: Type.BOOLEAN },
                    deathYear: { type: Type.STRING },
                    isIndexMember: { type: Type.BOOLEAN },
                    isAdopted: { type: Type.BOOLEAN },
                    nationality: { type: Type.STRING },
                    isLivingTogether: { type: Type.BOOLEAN },
                    birthOrder: { type: Type.NUMBER }
                  },
                  required: ["id", "name", "gender", "deceased"]
                }
              },
              relationships: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    from: { type: Type.STRING },
                    to: { type: Type.STRING },
                    type: { type: Type.STRING },
                    emotionalType: { type: Type.STRING },
                    twinType: { type: Type.STRING },
                    marriageYear: { type: Type.STRING },
                    divorceYear: { type: Type.STRING }
                  },
                  required: ["from", "to", "type"]
                }
              },
              analysis: { type: Type.STRING }
            },
            required: ["members", "relationships", "analysis"]
          }
        }
      });

      const text = response.text || '{}';
      const cleanText = text.replace(/^```json\n?|```$/gm, '').trim();
      let result = JSON.parse(cleanText) as GenogramData;
      
      result = normalizeData(result);
      
      setData(result);
      setModifyInput(''); // Clear input after successful modification
    } catch (err) {
      console.error(err);
      setError('가계도를 수정하는 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setModifying(false);
    }
  };

  const handleGenerateGoals = async () => {
    if (!data) return;
    
    setLoadingGoals(true);
    setError(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
다음 가족 가계도 데이터를 바탕으로 개입 목표를 세워주세요.
반드시 다음 3가지 항목으로 나누어 구체적으로 작성하세요. 각 항목 사이에는 반드시 빈 줄을 두어 가독성을 높여주세요. 각 항목의 소제목은 마크다운 헤딩(###)과 굵은 글씨(**텍스트**)를 사용하여 명확하게 구분되도록 작성하세요:

### **1. CT의 목표**

### **2. 상담가의 목표**

### **3. 사회복지사의 목표**

가족 데이터:
${JSON.stringify(data, null, 2)}
`;
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: prompt,
      });

      setInterventionGoals(response.text || '');
    } catch (err) {
      console.error(err);
      setError('개입 목표를 생성하는 중 오류가 발생했습니다.');
    } finally {
      setLoadingGoals(false);
    }
  };

  const handleShowExample = () => {
    const exampleText = "CT(김00, 35세)는 아내(이00, 33세)와 결혼하여 아들(김00, 5세)을 두고 있습니다. CT의 아버지는 3년 전 돌아가셨고, 어머니는 현재 CT가족과 함께 살고 있습니다. 아내와 어머니 사이에는 고부 갈등이 심한 편입니다. CT는 형이 한 명 있는데, 형은 결혼해서 지방에 살고 있으며 연락이 뜸합니다. CT는 고부 사이에서 스트레스를 많이 받고 있습니다.";
    setInput(exampleText);
  };

  const handleCopyAnalysis = () => {
    if (data?.analysis) {
      navigator.clipboard.writeText(data.analysis);
      setCopiedAnalysis(true);
      setTimeout(() => setCopiedAnalysis(false), 2000);
    }
  };

  const handleCopyGoals = () => {
    if (interventionGoals) {
      navigator.clipboard.writeText(interventionGoals);
      setCopiedGoals(true);
      setTimeout(() => setCopiedGoals(false), 2000);
    }
  };

  const handleCopyImage = async () => {
    if (canvasRef.current) {
      const success = await canvasRef.current.copyPNG();
      if (success) {
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2000);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200">
              <Users className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-800">온가족 가계도</h1>
              <p className="text-xs text-slate-500 font-medium">AI기반 상담/사례관리 가계도 제작 및 분석</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input & Analysis */}
        <div className="lg:col-span-5 space-y-6">
          {/* Input Card */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-800 font-semibold">
                <History className="w-5 h-5 text-emerald-600" />
                <h2>가족 히스토리 입력</h2>
              </div>
              <div className="flex items-center gap-2">
                <input 
                  type="file" 
                  accept=".pdf,image/jpeg,image/png,image/jpg" 
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loadingFile}
                  className="px-3 py-2 rounded-lg font-medium text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors flex items-center gap-1"
                >
                  {loadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  파일 첨부
                </button>
                <button
                  onClick={handleShowExample}
                  className="px-3 py-2 rounded-lg font-medium text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  예시
                </button>
              </div>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">
              가족 구성원, 나이, 건강 상태, 그리고 서로의 관계(친밀함, 갈등 등)를 자유롭게 적어주세요.<br/>
              <span className="text-red-500 font-semibold">주의: CT/내담자 이름은 실명으로 쓰지 않도록 주의해주세요.</span>
            </p>
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="예: CT(김00, 30세) 가족은 아버지(사망, 위암), 어머니(58세), 형(35세)으로 구성되어 있습니다. 아버지는 어머니와 자주 다투셨고, CT는 어머니와 지나치게 밀착되어 있습니다. 형과 CT의 관계는 단절되어 있습니다."
                className="w-full h-48 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all resize-none text-sm leading-relaxed"
              />
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={analyzeFamily}
                disabled={loading || !input.trim()}
                className={cn(
                  "px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-sm text-sm",
                  loading || !input.trim() 
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none" 
                    : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95"
                )}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                가계도 제작
              </button>
            </div>
          </section>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl flex items-start gap-3 text-sm">
              <Info className="w-5 h-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* Right Column: Visualization */}
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 h-[850px] flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-800 font-semibold">
                <Heart className="w-5 h-5 text-rose-500" />
                <h2>가계도</h2>
              </div>
              <div className="flex items-center gap-2">
                {data && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-1 rounded">
                    {data.members.length} Members Detected
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex-1 min-h-0 relative">
              {data ? (
                <GenogramCanvas ref={canvasRef} data={data} />
              ) : (
                <div className="w-full h-full bg-slate-50 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 space-y-3">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100">
                    <Users className="w-8 h-8 opacity-20" />
                  </div>
                  <p className="text-sm font-medium">히스토리를 입력하면 가계도가 생성됩니다</p>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            {data && (
              <div className="flex flex-col gap-4 pt-4 border-t border-slate-100">
                {/* Modification Input Area */}
                <div className="flex gap-2 items-center bg-slate-50 p-3 rounded-xl border border-slate-200 shrink-0">
                  <input
                    type="text"
                    value={modifyInput}
                    onChange={(e) => setModifyInput(e.target.value)}
                    placeholder="가계도 수정 요청 (예: 아버지는 사망하셨습니다, 어머니는 당뇨가 있습니다)"
                    className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleModify();
                      }
                    }}
                  />
                  <button
                    onClick={handleModify}
                    disabled={modifying || !modifyInput.trim()}
                    className={cn(
                      "px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-all shadow-sm text-sm whitespace-nowrap",
                      modifying || !modifyInput.trim() 
                        ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none" 
                        : "bg-slate-800 text-white hover:bg-slate-900 active:scale-95"
                    )}
                  >
                    {modifying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Edit3 className="w-4 h-4" />
                    )}
                    수정하기
                  </button>
                </div>
                
                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-2">
                  <button 
                    onClick={() => canvasRef.current?.resetView()}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
                    title="화면 초기화"
                  >
                    <Maximize className="w-4 h-4" />
                    화면 초기화
                  </button>
                  <button 
                    onClick={handleCopyImage}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
                    title="이미지복사"
                  >
                    {copiedImage ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    이미지복사
                  </button>
                  <button 
                    onClick={() => canvasRef.current?.downloadPNG()}
                    className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
                    title="이미지저장"
                  >
                    <Download className="w-4 h-4" />
                    이미지저장
                  </button>
                  <button
                    onClick={() => setShowAnalysisModal(!showAnalysisModal)}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 border shadow-sm",
                      showAnalysisModal 
                        ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                        : "bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                    )}
                  >
                    <AlertCircle className="w-4 h-4" />
                    가족 문제 분석
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Analysis Section */}
          {showAnalysisModal && data && (
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2 text-slate-800">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <h2 className="text-xl font-bold">가족 문제 분석</h2>
                </div>
                <button 
                  onClick={() => setShowAnalysisModal(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="prose prose-base prose-slate max-w-none prose-h3:text-lg prose-h3:font-bold prose-h3:text-slate-800 prose-p:text-[15px] prose-p:text-slate-600 prose-li:text-[15px] prose-li:text-slate-600 prose-p:my-4 prose-li:my-2 leading-relaxed prose-h3:mt-10 prose-h3:mb-4">
                <ReactMarkdown>{data.analysis}</ReactMarkdown>
              </div>
              
              <div className="pt-4 border-t border-slate-100 flex gap-2">
                <button
                  onClick={handleCopyAnalysis}
                  className="px-4 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 active:scale-95"
                >
                  {copiedAnalysis ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  복사하기
                </button>
                <button
                  onClick={handleGenerateGoals}
                  disabled={loadingGoals}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm",
                    loadingGoals
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none" 
                      : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 active:scale-95"
                  )}
                >
                  {loadingGoals ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Target className="w-4 h-4" />
                  )}
                  [개입 목표] 생성하기
                </button>
              </div>

              {interventionGoals && (
                <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 animate-in fade-in slide-in-from-top-2 duration-500 space-y-4">
                  <div className="prose prose-base prose-indigo max-w-none prose-h3:text-lg prose-h3:font-bold prose-h3:text-indigo-900 prose-p:text-[15px] prose-p:text-indigo-900/80 prose-li:text-[15px] prose-li:text-indigo-900/80 prose-p:my-4 prose-li:my-2 leading-relaxed prose-h3:mt-8 prose-h3:mb-4">
                    <ReactMarkdown>{interventionGoals}</ReactMarkdown>
                  </div>
                  <div className="flex justify-end pt-2 border-t border-indigo-100/50">
                    <button
                      onClick={handleCopyGoals}
                      className="px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all shadow-sm text-sm bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 active:scale-95"
                    >
                      {copiedGoals ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      복사하기
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-8 text-center text-slate-400 text-xs">
        <p>© 동대문구가족센터, 2026 온가족 가계도 - AI 기반 가족 관계 분석 도구</p>
      </footer>
    </div>
  );
}
