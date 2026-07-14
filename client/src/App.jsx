import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:3001');

function App() {
  const [view, setView] = useState('menu');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [players, setPlayers] = useState([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [currentQNumber, setCurrentQNumber] = useState(1);
  const [userRole, setUserRole] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [roomRules, setRoomRules] = useState('');
  const [roomTimeLimit, setRoomTimeLimit] = useState(30);
  
  // Состояния для создания вопроса
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [showQuestionsList, setShowQuestionsList] = useState(false);
  const [questionType, setQuestionType] = useState('single');
  const [newQuestion, setNewQuestion] = useState({
    text: '',
    imageUrl: '',
    category: 'Общие знания',
    options: ['', '', '', ''],
    correctAnswerIndex: 0,
    correctAnswerIndices: [0],
    multiple: false
  });

  // Состояния для ответа участника и таймера
  const [selectedAnswers, setSelectedAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(30);
  const timerRef = useRef(null);

  useEffect(() => {
    socket.on('room_created', ({ code }) => {
      setRoomCode(code);
      setUserRole('host');
      setView('host_lobby');
    });

    socket.on('player_joined', ({ players, rules, timeLimit }) => {
      setPlayers(players);
      if (rules) setRoomRules(rules);
      if (timeLimit) setRoomTimeLimit(timeLimit);
    });

    socket.on('questions_updated', (q) => setQuestions(q));

    socket.on('quiz_started', ({ question, totalQuestions, currentQuestionNumber, timeLimit }) => {
      setCurrentQuestion(question);
      setTotalQuestions(totalQuestions);
      setCurrentQNumber(currentQuestionNumber || 1);
      setSelectedAnswers([]);
      setTimeLeft(timeLimit || 30);
      setView('quiz');
    });

    socket.on('quiz_finished', ({ leaderboard }) => {
      setLeaderboard(leaderboard);
      setView('leaderboard');
      if (timerRef.current) clearInterval(timerRef.current);
    });

    socket.on('error', (message) => {
      setErrorMessage(message);
      setTimeout(() => setErrorMessage(''), 3000);
    });

    return () => {
      socket.off();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Логика таймера
  useEffect(() => {
    if (view === 'quiz' && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (timeLeft === 0 && view === 'quiz') {
      // Время вышло, можно автоматически отправлять пустой ответ или блокировать UI
      if (currentQuestion && userRole === 'participant' && selectedAnswers.length === 0 && !currentQuestion.multiple) {
         // Авто-отправка пустого ответа для одиночного выбора, если время вышло
         socket.emit('submit_answer', { roomCode, answerIndex: -1 });
         setCurrentQuestion(null);
      }
    }
    return () => clearInterval(timerRef.current);
  }, [view, timeLeft, currentQuestion, userRole, roomCode, selectedAnswers]);

  const createRoom = () => {
    if (name) socket.emit('create_room', { hostName: name, rules: roomRules, timeLimit: roomTimeLimit });
  };

  const joinRoom = () => {
    if (name && roomCode) {
      socket.emit('join_room', { roomCode, playerName: name });
      setUserRole('participant');
    }
  };

  const handleOptionChange = (index, value) => {
    const updatedOptions = [...newQuestion.options];
    updatedOptions[index] = value;
    setNewQuestion({ ...newQuestion, options: updatedOptions });
  };

  const toggleCorrectAnswer = (index) => {
    if (questionType === 'single') {
      setNewQuestion({ ...newQuestion, correctAnswerIndex: index });
    } else {
      const indices = newQuestion.correctAnswerIndices.includes(index)
        ? newQuestion.correctAnswerIndices.filter(i => i !== index)
        : [...newQuestion.correctAnswerIndices, index];
      setNewQuestion({ ...newQuestion, correctAnswerIndices: indices });
    }
  };

  const addCustomQuestion = () => {
    if (!newQuestion.text || !newQuestion.options.every(opt => opt.trim() !== '')) {
      alert('Заполните текст вопроса и все варианты ответов!');
      return;
    }
    if (questionType === 'multiple' && newQuestion.correctAnswerIndices.length < 2) {
      alert('Для вопроса с несколькими ответами нужно выбрать минимум 2 правильных варианта!');
      return;
    }

    const question = {
      text: newQuestion.text,
      imageUrl: newQuestion.imageUrl.trim(),
      category: newQuestion.category,
      options: newQuestion.options,
      correctAnswerIndex: newQuestion.correctAnswerIndex,
      correctAnswerIndices: newQuestion.correctAnswerIndices,
      multiple: questionType === 'multiple'
    };

    socket.emit('add_question', { roomCode, question });
    setNewQuestion({
      text: '',
      imageUrl: '',
      category: 'Общие знания',
      options: ['', '', '', ''],
      correctAnswerIndex: 0,
      correctAnswerIndices: [0],
      multiple: false
    });
  };

  const deleteQuestion = (index) => {
    const updatedQuestions = questions.filter((_, i) => i !== index);
    socket.emit('update_questions_list', { roomCode, questions: updatedQuestions });
  };

  const startQuiz = () => socket.emit('start_quiz', { roomCode });
  const nextQuestion = () => socket.emit('next_question', { roomCode });
  
  const toggleAnswer = (index) => {
    if (currentQuestion.multiple) {
      setSelectedAnswers(prev => 
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    }
  };

  const submitAnswer = (index) => {
    if (timeLeft === 0) return; // Запрет ответа, если время вышло

    if (currentQuestion.multiple) {
      if (selectedAnswers.length === 0) {
        alert('Выберите хотя бы один вариант ответа!');
        return;
      }
      socket.emit('submit_answer', { roomCode, answerIndices: selectedAnswers });
    } else {
      socket.emit('submit_answer', { roomCode, answerIndex: index });
    }
    setCurrentQuestion(null);
  };

  // Форматирование времени (MM:SS)
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-center mb-6 text-indigo-600">QuizApp</h1>

        {view === 'menu' && (
          <div className="space-y-4">
            <input className="w-full p-2 border rounded" placeholder="Ваше имя" value={name} onChange={e => setName(e.target.value)} />
            <button onClick={() => setView('host_setup')} className="w-full bg-indigo-600 text-white p-2 rounded">Создать квиз (Организатор)</button>
            <button onClick={() => setView('participant_join')} className="w-full bg-green-600 text-white p-2 rounded">Присоединиться (Участник)</button>
          </div>
        )}

        {view === 'host_setup' && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border">
              <h3 className="font-bold mb-2">Настройки комнаты</h3>
              <label className="text-sm text-gray-600">Время на вопрос (секунды):</label>
              <input type="number" className="w-full p-2 border rounded mb-3" value={roomTimeLimit} onChange={e => setRoomTimeLimit(e.target.value)} min="5" max="300" />
              <label className="text-sm text-gray-600">Правила проведения:</label>
              <textarea className="w-full p-2 border rounded" rows="3" placeholder="Например: Опрос будет длится 10 минут, по 1 миинуте на вопрос. За правильный ответ 10 баллов..." value={roomRules} onChange={e => setRoomRules(e.target.value)} />
            </div>
            <button onClick={createRoom} className="w-full bg-indigo-600 text-white p-2 rounded">Сгенерировать комнату</button>
            <button onClick={() => setView('menu')} className="w-full text-gray-600">Назад</button>
          </div>
        )}

        {view === 'host_lobby' && (
          <div className="space-y-4 text-center">
            <p className="text-lg">Код комнаты: <span className="font-bold text-2xl text-indigo-600">{roomCode}</span></p>
            <div className="bg-blue-50 p-3 rounded text-left text-sm">
              <p><strong>⏱ Время на вопрос:</strong> {roomTimeLimit} сек.</p>
              <p><strong>📜 Правила:</strong> {roomRules || 'Стандартные'}</p>
            </div>
            <p>Участников: {players.length}</p>
            <ul className="text-left bg-gray-50 p-2 rounded max-h-32 overflow-y-auto">
              {players.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
            
            <div className="flex space-x-2">
              <button onClick={() => { setShowQuestionForm(!showQuestionForm); setShowQuestionsList(false); }} className={`flex-1 p-2 rounded text-white ${showQuestionForm ? 'bg-red-500' : 'bg-blue-500'}`}>
                {showQuestionForm ? 'Закрыть форму' : '+ Добавить вопрос'}
              </button>
              <button onClick={() => { setShowQuestionsList(!showQuestionsList); setShowQuestionForm(false); }} className={`flex-1 p-2 rounded text-white ${showQuestionsList ? 'bg-red-500' : 'bg-purple-500'}`}>
                {showQuestionsList ? 'Закрыть список' : ` Вопросы (${questions.length})`}
              </button>
            </div>
            
            {showQuestionForm && (
              <div className="bg-blue-50 p-4 rounded space-y-3 text-left border-2 border-blue-200">
                <h3 className="font-bold text-lg text-blue-800"> Создание вопроса #{questions.length + 1}</h3>
                
                <select className="w-full p-2 border rounded" value={newQuestion.category} onChange={e => setNewQuestion({...newQuestion, category: e.target.value})}>
                  <option>Общие знания</option>
                  <option>Наука и техника</option>
                  <option>История</option>
                  <option>Кино и музыка</option>
                  <option>Спорт</option>
                </select>

                <input className="w-full p-2 border rounded" placeholder="Текст вопроса" value={newQuestion.text} onChange={(e) => setNewQuestion({...newQuestion, text: e.target.value})} />
                
                <input className="w-full p-2 border rounded" placeholder="Ссылка на картинку (URL, необязательно)" value={newQuestion.imageUrl} onChange={(e) => setNewQuestion({...newQuestion, imageUrl: e.target.value})} />
                
                <div className="flex space-x-2 bg-white p-2 rounded border">
                  <button onClick={() => { setQuestionType('single'); setNewQuestion({...newQuestion, correctAnswerIndices: [newQuestion.correctAnswerIndex]}); }} className={`flex-1 p-2 rounded font-bold transition ${questionType === 'single' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
                    Один ответ
                  </button>
                  <button onClick={() => { setQuestionType('multiple'); setNewQuestion({...newQuestion, correctAnswerIndices: [0, 1]}); }} className={`flex-1 p-2 rounded font-bold transition ${questionType === 'multiple' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
                    Несколько ответов
                  </button>
                </div>

                <p className="text-sm font-semibold text-blue-800">Варианты ответов:</p>
                {newQuestion.options.map((opt, idx) => (
                  <div key={idx} className="flex items-center space-x-2">
                    {questionType === 'single' ? (
                      <input type="radio" name="correctAnswer" checked={newQuestion.correctAnswerIndex === idx} onChange={() => toggleCorrectAnswer(idx)} className="w-4 h-4 text-green-600" />
                    ) : (
                      <input type="checkbox" checked={newQuestion.correctAnswerIndices.includes(idx)} onChange={() => toggleCorrectAnswer(idx)} className="w-4 h-4 text-green-600" />
                    )}
                    <input className="flex-1 p-2 border rounded" placeholder={`Вариант ${idx + 1}`} value={opt} onChange={(e) => handleOptionChange(idx, e.target.value)} />
                  </div>
                ))}
                
                <button onClick={addCustomQuestion} className="w-full bg-green-600 hover:bg-green-700 text-white p-2 rounded font-bold transition">✓ Добавить вопрос</button>
              </div>
            )}
            
            {showQuestionsList && (
              <div className="bg-purple-50 p-4 rounded space-y-3 text-left border-2 border-purple-200 max-h-96 overflow-y-auto">
                <h3 className="font-bold text-lg text-purple-800">📋 Добавленные вопросы ({questions.length})</h3>
                {questions.length === 0 ? (
                  <p className="text-gray-600 text-center">Пока нет вопросов.</p>
                ) : (
                  questions.map((q, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border border-purple-200 relative">
                      <button onClick={(e) => { e.stopPropagation(); deleteQuestion(idx); }} className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-1 px-2 rounded transition z-10">Удалить</button>
                      <div className="pr-20">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-bold text-purple-800">Вопрос {idx + 1}:</span>
                          <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">{q.category}</span>
                          {q.multiple && <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded">Несколько ответов</span>}
                        </div>
                        {q.imageUrl && <img src={q.imageUrl} alt="question" className="w-full h-32 object-cover rounded mb-2" />}
                        <p className="text-gray-800 mb-2">{q.text}</p>
                        <ul className="text-sm text-gray-600 space-y-1">
                          {q.options.map((opt, optIdx) => {
                            const isCorrect = q.multiple ? q.correctAnswerIndices.includes(optIdx) : q.correctAnswerIndex === optIdx;
                            return <li key={optIdx} className={isCorrect ? 'text-green-600 font-bold' : ''}>{isCorrect ? '✓ ' : '  '}{opt}</li>;
                          })}
                        </ul>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            
            <div className="bg-gray-100 p-3 rounded">
              <p className="text-lg font-bold text-gray-700">Всего вопросов: <span className="text-indigo-600 text-2xl">{questions.length}</span></p>
            </div>
            
            <button onClick={startQuiz} disabled={questions.length === 0} className="w-full bg-green-600 hover:bg-green-700 text-white p-3 rounded font-bold text-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition"> Запустить квиз</button>
          </div>
        )}

        {view === 'participant_join' && (
          <div className="space-y-4">
            {errorMessage && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">{errorMessage}</div>}
            <input className="w-full p-2 border rounded" placeholder="Ваше имя" value={name} onChange={e => setName(e.target.value)} />
            <input className="w-full p-2 border rounded" placeholder="Код комнаты" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} />
            <button onClick={joinRoom} className="w-full bg-green-600 text-white p-2 rounded">Войти</button>
            <button onClick={() => setView('menu')} className="w-full text-gray-600">Назад</button>
          </div>
        )}

        {view === 'quiz' && currentQuestion && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-500">Вопрос {currentQNumber} из {totalQuestions} | {currentQuestion.category}</p>
              <div className={`font-mono font-bold text-lg px-3 py-1 rounded ${timeLeft <= 5 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-indigo-100 text-indigo-600'}`}>
                ⏱ {formatTime(timeLeft)}
              </div>
            </div>
            
            {currentQuestion.imageUrl && (
              <img src={currentQuestion.imageUrl} alt="question visual" className="w-full h-48 object-cover rounded-lg border" />
            )}
            
            <h2 className="text-xl font-semibold">{currentQuestion.text}</h2>
            
            {userRole === 'participant' && timeLeft === 0 && (
              <div className="bg-red-100 text-red-700 p-3 rounded text-center font-bold">Время на ответ вышло!</div>
            )}

            <div className="space-y-2">
              {currentQuestion.options.map((opt, idx) => (
                currentQuestion.multiple ? (
                  <button key={idx} onClick={() => timeLeft > 0 && toggleAnswer(idx)} disabled={timeLeft === 0} className={`w-full text-left p-3 border rounded transition ${selectedAnswers.includes(idx) ? 'bg-indigo-100 border-indigo-500' : 'hover:bg-indigo-50'} ${timeLeft === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <span className="mr-2">{selectedAnswers.includes(idx) ? '☑' : '☐'}</span>{opt}
                  </button>
                ) : (
                  <button key={idx} onClick={() => timeLeft > 0 && submitAnswer(idx)} disabled={timeLeft === 0} className={`w-full text-left p-3 border rounded hover:bg-indigo-50 transition ${timeLeft === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    {opt}
                  </button>
                )
              ))}
            </div>
            
            {currentQuestion.multiple && userRole === 'participant' && (
              <button onClick={() => submitAnswer(null)} disabled={selectedAnswers.length === 0 || timeLeft === 0} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded font-bold transition disabled:bg-gray-400">
                Ответить ({selectedAnswers.length} выбрано)
              </button>
            )}

            {userRole === 'host' && (
              <div className="pt-4 border-t">
                <p className="text-sm text-gray-600 mb-2">Управление квизом (Организатор):</p>
                <button onClick={nextQuestion} className="w-full bg-yellow-500 hover:bg-yellow-600 text-white p-3 rounded font-bold transition">
                  {currentQNumber === totalQuestions ? '🏆 Завершить квиз и показать результаты' : '➡️ Следующий вопрос'}
                </button>
              </div>
            )}
          </div>
        )}

        {view === 'quiz' && userRole === 'participant' && !currentQuestion && (
          <div className="text-center py-8">
            <p className="text-xl font-bold text-green-600">✓ Ответ принят!</p>
            <p className="text-gray-600">Ждите следующего вопроса...</p>
          </div>
        )}

        {view === 'leaderboard' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-center">🏆 Итоги квиза</h2>
            <ol className="space-y-2">
              {leaderboard.map((player, idx) => (
                <li key={idx} className={`flex justify-between p-3 rounded ${idx === 0 ? 'bg-yellow-100 border-2 border-yellow-400' : 'bg-indigo-50'}`}>
                  <span className="font-bold">#{idx + 1} {player.name}</span>
                  <span className="font-bold">{player.score} баллов</span>
                </li>
              ))}
            </ol>
            <button onClick={() => window.location.reload()} className="w-full bg-gray-600 hover:bg-gray-700 text-white p-2 rounded mt-4 transition">В меню</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;