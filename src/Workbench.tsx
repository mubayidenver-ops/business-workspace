import { useEffect, useRef, useState } from 'react';
import { Upload, Download, Plus, Check, FileText } from 'lucide-react';
import { cleanCSV, cleanRows, writeCSV } from '../shared/csv.mjs';
import { readXlsx } from '../shared/xlsx.mjs';
import { download } from './lib';
import type { Tool } from './types';
type CsvResult = { rows: string[][]; duplicates: number; empty: number; warnings: string[] };
export function Workbench({ tool }: { tool: Tool }) {
  const [error, setError] = useState('');
  return (
    <section className="workbench">
      <div className="section-heading">
        <div>
          <span className="eyebrow">WORKBENCH</span>
          <h2>Make something useful.</h2>
        </div>
        <span className="badge">Runs in your browser</span>
      </div>
      <p className="muted">
        Files stay on your device. Download your results before leaving this page.
      </p>
      {tool.utility === 'csv' ? (
        <CSVBox onError={setError} />
      ) : tool.utility === 'image' ? (
        <ImageBox onError={setError} />
      ) : tool.utility === 'pdf' ? (
        <PDFBox onError={setError} />
      ) : tool.utility === 'captions' ? (
        <CaptionsBox onError={setError} />
      ) : tool.utility === 'content' ? (
        <ContentBox />
      ) : tool.utility === 'quiz' ? (
        <QuizBox onError={setError} />
      ) : tool.utility === 'language' ? (
        <LanguageBox />
      ) : null}
      <p className="error" role="alert">
        {error}
      </p>
    </section>
  );
}
function CSVBox({ onError }: { onError: (s: string) => void }) {
  const [text, setText] = useState(''),
    [delimiter, setDelimiter] = useState(','),
    [output, setOutput] = useState(','),
    [result, setResult] = useState<CsvResult | null>(null),
    [sheets, setSheets] = useState<{ name: string; rows: string[][] }[]>([]),
    [sheet, setSheet] = useState(0);
  function run() {
    onError('');
    try {
      setResult(sheets.length ? cleanRows(sheets[sheet].rows) : cleanCSV(text, delimiter));
    } catch (e) {
      setResult(null);
      onError((e as Error).message);
    }
  }
  return (
    <>
      <div className="utility-grid">
        <label>
          Paste CSV data
          <textarea
            className="resize-none"
            rows={9}
            style={{ resize: 'none' }}
            value={text}
            readOnly={sheets.length > 0}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            placeholder={'Name,Email\nAlex,alex@example.com'}
          />
        </label>
        <div>
          <label className="upload">
            <Upload size={24} />
            <strong>Choose a CSV or Excel file</strong>
            <span>CSV, TSV or .xlsx · up to 5 MB · processed in your browser</span>
            <input
              type="file"
              accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5e6) {
                  onError('Choose a file smaller than 5 MB.');
                  return;
                }
                if (/\.xlsx$/i.test(file.name)) {
                  try {
                    const book = await readXlsx(new Uint8Array(await file.arrayBuffer()));
                    setSheets(book);
                    setSheet(0);
                    setText(
                      book[0].rows
                        .slice(0, 50)
                        .map((r) => r.join('\t'))
                        .join('\n'),
                    );
                  } catch (error) {
                    onError((error as Error).message);
                    return;
                  }
                } else {
                  setSheets([]);
                  setText(await file.text());
                }
                setResult(null);
                onError('');
              }}
            />
          </label>
          {sheets.length > 1 && (
            <label>
              Worksheet
              <select
                value={sheet}
                onChange={(e) => {
                  setSheet(Number(e.target.value));
                  setText(
                    sheets[Number(e.target.value)].rows
                      .slice(0, 50)
                      .map((r) => r.join('\t'))
                      .join('\n'),
                  );
                  setResult(null);
                }}
              >
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-grid">
            <label>
              Input separator
              <select
                value={delimiter}
                onChange={(e) => {
                  setDelimiter(e.target.value);
                  setResult(null);
                }}
              >
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={'\t'}>Tab</option>
              </select>
            </label>
            <label>
              Output separator
              <select value={output} onChange={(e) => setOutput(e.target.value)}>
                <option value=",">Comma</option>
                <option value=";">Semicolon</option>
                <option value={'\t'}>Tab</option>
              </select>
            </label>
          </div>
          <button className="primary full" onClick={run}>
            Clean & validate
          </button>
        </div>
      </div>
      {result && (
        <div className="result">
          <strong>{result.rows.length - 1} rows ready</strong>
          <p>
            {result.duplicates} duplicate rows removed · {result.empty} empty rows removed ·
            whitespace trimmed
          </p>
          {result.warnings.length > 0 && (
            <div className="notice">
              {result.warnings.slice(0, 10).map((w) => (
                <p key={w}>{w}</p>
              ))}
              {result.warnings.length > 10 && <p>{result.warnings.length - 10} more warnings</p>}
            </div>
          )}
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Cleaned data preview, first 6 rows</caption>
              <thead>
                <tr>
                  {result.rows[0].map((v, i) => (
                    <th key={i}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(1, 7).map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() =>
              download(
                output === '\t' ? 'cleaned.tsv' : 'cleaned.csv',
                writeCSV(result.rows, output),
                'text/csv',
              )
            }
          >
            <Download size={16} /> Download cleaned file
          </button>
        </div>
      )}
    </>
  );
}
function ImageBox({ onError }: { onError: (s: string) => void }) {
  const [source, setSource] = useState(''),
    [size, setSize] = useState({ width: 1200, height: 1200 }),
    [format, setFormat] = useState('image/png'),
    [busy, setBusy] = useState(false);
  const image = useRef<HTMLImageElement | null>(null);
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );
  async function select(file?: File) {
    if (!file) return;
    onError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10e6) {
      onError('Choose a PNG, JPG or WebP smaller than 10 MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      if (img.width * img.height > 40000000) {
        URL.revokeObjectURL(url);
        onError('Choose an image with fewer than 40 million pixels.');
        return;
      }
      image.current = img;
      setSource(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      onError('This image could not be read. Try another file.');
    };
    img.src = url;
  }
  async function resize() {
    onError('');
    const { width, height } = size;
    if (
      !image.current ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 4096 ||
      height > 4096
    ) {
      onError('Choose an image and dimensions between 1 and 4096 pixels.');
      return;
    }
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width / image.current.width, height / image.current.height);
      const w = image.current.width * scale,
        h = image.current.height * scale;
      ctx.drawImage(image.current, (width - w) / 2, (height - h) / 2, w, h);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, format, 0.92));
      if (!blob) throw new Error('Could not create the image.');
      download('product-image.' + (format === 'image/png' ? 'png' : 'jpg'), blob);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="utility-grid">
      <label className="upload image-upload">
        {source ? (
          <img src={source} alt="Selected product preview" />
        ) : (
          <>
            <Upload size={32} />
            <strong>Choose your product image</strong>
            <span>PNG, JPG or WebP · up to 10 MB</span>
          </>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void select(e.target.files?.[0])}
        />
      </label>
      <div>
        <div className="form-grid">
          <label>
            Width (px)
            <input
              type="number"
              value={size.width}
              min={1}
              max={4096}
              onChange={(e) => setSize({ ...size, width: Number(e.target.value) })}
            />
          </label>
          <label>
            Height (px)
            <input
              type="number"
              value={size.height}
              min={1}
              max={4096}
              onChange={(e) => setSize({ ...size, height: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          File format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="image/png">PNG</option>
            <option value="image/jpeg">JPG</option>
          </select>
        </label>
        <p className="muted">
          Your image keeps its proportions and fits inside the chosen size, with white padding where
          needed.
        </p>
        <button className="primary" disabled={!source || busy} onClick={() => void resize()}>
          <Download size={16} />
          {busy ? 'Preparing…' : 'Resize & download'}
        </button>
      </div>
    </div>
  );
}
function PDFBox({ onError }: { onError: (s: string) => void }) {
  const [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [pages, setPages] = useState(''),
    [mode, setMode] = useState('merge');
  async function process() {
    onError('');
    if (!files.length) {
      onError('Choose at least one PDF.');
      return;
    }
    setBusy(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const out = await PDFDocument.create();
      if (mode === 'merge') {
        for (const file of files) {
          const doc = await PDFDocument.load(await file.arrayBuffer());
          for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
        }
      } else {
        if (files.length !== 1) throw new Error('Choose exactly one PDF to extract pages.');
        const doc = await PDFDocument.load(await files[0].arrayBuffer());
        const indices = pages.split(',').map((n) => Number(n.trim()) - 1);
        if (!pages || indices.some((n) => !Number.isInteger(n) || n < 0 || n >= doc.getPageCount()))
          throw new Error(
            `Enter page numbers from 1 to ${doc.getPageCount()}, separated by commas.`,
          );
        for (const page of await out.copyPages(doc, indices)) out.addPage(page);
      }
      const bytes = await out.save();
      download(
        mode === 'merge' ? 'merged.pdf' : 'extracted.pdf',
        new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }),
      );
    } catch (e) {
      onError(
        (e as Error).message.includes('encrypt')
          ? 'Password-protected PDFs are not supported.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="utility-grid">
        <label className="upload">
          <FileText size={32} />
          <strong>Choose PDF files</strong>
          <span>Up to 10 files · 20 MB total</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              if (list.length > 10 || list.reduce((n, f) => n + f.size, 0) > 20e6) {
                onError('Choose up to 10 PDFs, smaller than 20 MB in total.');
                return;
              }
              setFiles(list);
              onError('');
            }}
          />
        </label>
        <div>
          <label>
            Operation
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="merge">Merge PDFs in the order below</option>
              <option value="extract">Extract pages from one PDF</option>
            </select>
          </label>
          {mode === 'extract' && (
            <label>
              Page numbers
              <input
                placeholder="1, 3, 5"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
            </label>
          )}
          <button
            className="primary"
            disabled={busy || !files.length}
            onClick={() => void process()}
          >
            {busy ? 'Processing…' : 'Create PDF'}
          </button>
        </div>
      </div>
      {files.map((file, i) => (
        <div className="file-row" key={i}>
          <span>
            {i + 1}. {file.name}
          </span>
          <button
            disabled={!i || busy}
            onClick={() =>
              setFiles((list) => {
                const next = [...list];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                return next;
              })
            }
          >
            Move up
          </button>
        </div>
      ))}
    </>
  );
}
function CaptionsBox({ onError }: { onError: (s: string) => void }) {
  const [text, setText] = useState('');
  function exportCaptions(vtt = false) {
    onError('');
    if (!text.trim() || !/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/m.test(text)) {
      onError('Use SRT timestamps, such as 00:00:01,000 --> 00:00:03,000.');
      return;
    }
    download(
      vtt ? 'captions.vtt' : 'captions.srt',
      vtt ? 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2') : text,
    );
  }
  return (
    <>
      <label>
        Import SRT file
        <input
          type="file"
          accept=".srt,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 2e6) {
              onError('Choose a caption file under 2 MB.');
              return;
            }
            setText(await f.text());
            onError('');
          }}
        />
      </label>
      <label>
        Caption text and timestamps
        <textarea
          className="resize-none"
          rows={12}
          style={{ resize: 'none' }}
          placeholder={'1\n00:00:01,000 --> 00:00:03,000\nWelcome to our story.'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="actions">
        <button onClick={() => exportCaptions(false)}>
          <Download size={16} />
          Export SRT
        </button>
        <button onClick={() => exportCaptions(true)}>Export WebVTT</button>
      </div>
    </>
  );
}
function ContentBox() {
  const [source, setSource] = useState(''),
    [format, setFormat] = useState('LinkedIn post'),
    [output, setOutput] = useState('');
  function generate() {
    const trimmed = source.trim();
    const sentences = trimmed.match(/[^.!?]+[.!?]*/g) || [trimmed];
    const lead = sentences[0].trim();
    setOutput(
      format === 'Email newsletter'
        ? `Subject: ${lead.slice(0, 65)}\n\nHello,\n\n${trimmed}\n\nWhat would you add? Reply and let me know.`
        : format === 'Short video script'
          ? `OPENING\n${lead}\n\nMAIN POINT\n${sentences.slice(1).join(' ').trim() || 'Add your example here.'}\n\nCLOSING\nSave this for your next project.`
          : `${lead}\n\n${sentences.slice(1).join(' ').trim()}\n\nWhat has your experience been?`,
    );
  }
  return (
    <>
      <div className="utility-grid">
        <label>
          Source text
          <textarea
            className="resize-none"
            rows={9}
            style={{ resize: 'none' }}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Paste the idea or article you want to reshape."
          />
        </label>
        <div>
          <label>
            Format
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {['LinkedIn post', 'Email newsletter', 'Short video script'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <p className="muted">
            A template gives your existing words a new structure. Review and edit the draft before
            using it.
          </p>
          <button className="primary" disabled={!source.trim()} onClick={generate}>
            Create template draft
          </button>
        </div>
      </div>
      {output && (
        <>
          <label>
            Your editable draft
            <textarea
              className="resize-none"
              rows={10}
              style={{ resize: 'none' }}
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            />
          </label>
          <button onClick={() => download('content-draft.txt', output)}>
            <Download size={16} />
            Download draft
          </button>
        </>
      )}
    </>
  );
}
type Question = { question: string; options: string[]; answer: number };
function QuizBox({ onError }: { onError: (s: string) => void }) {
  const [questions, setQuestions] = useState<Question[]>([
      { question: '', options: ['', '', ''], answer: 0 },
    ]),
    [test, setTest] = useState(false),
    [answers, setAnswers] = useState<Record<number, number>>({}),
    [score, setScore] = useState<number | null>(null);
  function update(i: number, patch: Partial<Question>) {
    setQuestions((list) => list.map((q, n) => (n === i ? { ...q, ...patch } : q)));
  }
  function validate() {
    if (questions.some((q) => !q.question.trim() || q.options.some((o) => !o.trim()))) {
      onError('Complete every question and all three answers.');
      return false;
    }
    onError('');
    return true;
  }
  return (
    <>
      {!test
        ? questions.map((q, i) => (
            <fieldset key={i}>
              <legend>Question {i + 1}</legend>
              <label>
                Question
                <input
                  value={q.question}
                  onChange={(e) => update(i, { question: e.target.value })}
                />
              </label>
              <div className="form-grid">
                {q.options.map((o, j) => (
                  <label key={j}>
                    Answer {j + 1}
                    <input
                      value={o}
                      onChange={(e) =>
                        update(i, {
                          options: q.options.map((s, n) => (n === j ? e.target.value : s)),
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Correct answer
                  <select
                    value={q.answer}
                    onChange={(e) => update(i, { answer: Number(e.target.value) })}
                  >
                    {q.options.map((_, j) => (
                      <option value={j} key={j}>
                        Answer {j + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
          ))
        : questions.map((q, i) => (
            <fieldset key={i}>
              <legend>
                {i + 1}. {q.question}
              </legend>
              {q.options.map((o, j) => (
                <label className="radio-label" key={j}>
                  <input
                    type="radio"
                    name={'question-' + i}
                    checked={answers[i] === j}
                    onChange={() => {
                      setAnswers({ ...answers, [i]: j });
                      setScore(null);
                    }}
                  />
                  {o}
                </label>
              ))}
            </fieldset>
          ))}
      <div className="actions">
        {!test ? (
          <>
            <button
              onClick={() =>
                setQuestions([...questions, { question: '', options: ['', '', ''], answer: 0 }])
              }
              disabled={questions.length >= 30}
            >
              <Plus size={16} />
              Add question
            </button>
            <button
              className="primary"
              onClick={() => {
                if (validate()) {
                  setAnswers({});
                  setScore(null);
                  setTest(true);
                }
              }}
            >
              Try your quiz
            </button>
            <button
              onClick={() => {
                if (validate())
                  download('quiz.json', JSON.stringify(questions, null, 2), 'application/json');
              }}
            >
              Export quiz
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setTest(false)}>Back to editor</button>
            <button
              className="primary"
              onClick={() => {
                if (Object.keys(answers).length !== questions.length) {
                  onError('Answer every question before scoring.');
                  return;
                }
                onError('');
                setScore(questions.filter((q, i) => answers[i] === q.answer).length);
              }}
            >
              Check answers
            </button>
          </>
        )}
      </div>
      {score !== null && test && (
        <div className="result" role="status">
          <Check /> You scored {score} out of {questions.length}.
        </div>
      )}
    </>
  );
}
function LanguageBox() {
  const exercises = [
    {
      question: 'A guest arrives. Which greeting is most helpful?',
      options: ['Welcome! How can I help you today?', 'What do you want?', 'You are late.'],
      answer: 0,
      explanation: 'A welcoming greeting invites the guest to explain what they need.',
    },
    {
      question: 'A room is not ready yet. Choose a polite response.',
      options: [
        'Not my problem.',
        'Your room will be ready in 20 minutes. May I store your bags?',
        'Just wait.',
      ],
      answer: 1,
      explanation: 'Give a clear time and offer practical help.',
    },
    {
      question: 'A customer reports a problem. What do you say?',
      options: [
        'That cannot be true.',
        'Ask someone else.',
        'Thank you for letting us know. I will look into it.',
      ],
      answer: 2,
      explanation: 'Acknowledge the concern and explain your next action.',
    },
  ];
  const [step, setStep] = useState(0),
    [answer, setAnswer] = useState<number | null>(null),
    [score, setScore] = useState(0);
  const q = exercises[step];
  return (
    <div className="practice">
      <span className="badge">English · Hospitality</span>
      {q ? (
        <>
          <p className="muted">
            Exercise {step + 1} of {exercises.length}
          </p>
          <h3>{q.question}</h3>
          {q.options.map((o, i) => (
            <button
              className={
                'practice-option ' +
                (answer === i ? (i === q.answer ? 'correct' : 'incorrect') : '')
              }
              disabled={answer !== null}
              key={o}
              onClick={() => {
                setAnswer(i);
                if (i === q.answer) setScore(score + 1);
              }}
            >
              {o}
            </button>
          ))}
          {answer !== null && (
            <div className="result" role="status">
              <strong>{answer === q.answer ? 'Correct.' : 'Keep practising.'}</strong>
              <p>{q.explanation}</p>
              <button
                className="primary"
                onClick={() => {
                  setAnswer(null);
                  setStep(step + 1);
                }}
              >
                Next exercise
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <h3>
            Practice complete: {score} / {exercises.length}
          </h3>
          <p>Your progress is for this session.</p>
          <button
            onClick={() => {
              setStep(0);
              setScore(0);
              setAnswer(null);
            }}
          >
            Practise again
          </button>
        </>
      )}
    </div>
  );
}
