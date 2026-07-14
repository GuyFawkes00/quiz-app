const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:5173', methods: ['GET', 'POST'] }
});

const rooms = {};
const users = {};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create_room', ({ hostName, rules, timeLimit }) => {
    const code = generateRoomCode();
    rooms[code] = {
      host: socket.id,
      participants: [],
      questions: [],
      status: 'waiting',
      currentQ: 0,
      scores: {},
      rules: rules || 'Стандартные правила: 1 правильный ответ = 10 баллов.',
      timeLimit: parseInt(timeLimit) || 30 // Время на вопрос в секундах
    };
    users[socket.id] = { name: hostName, role: 'host', roomCode: code };
    socket.join(code);
    socket.emit('room_created', { code });
  });

  socket.on('add_question', ({ roomCode, question }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].questions.push(question);
      io.to(roomCode).emit('questions_updated', rooms[roomCode].questions);
    }
  });

  socket.on('update_questions_list', ({ roomCode, questions }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].questions = questions;
      io.to(roomCode).emit('questions_updated', rooms[roomCode].questions);
    }
  });

  socket.on('join_room', ({ roomCode, playerName }) => {
    if (rooms[roomCode] && rooms[roomCode].status === 'waiting') {
      const existingPlayer = rooms[roomCode].participants.find(id => users[id].name === playerName);
      
      if (existingPlayer) {
        socket.emit('error', 'Участник с таким именем уже есть в комнате!');
        return;
      }
      
      rooms[roomCode].participants.push(socket.id);
      rooms[roomCode].scores[socket.id] = 0;
      users[socket.id] = { name: playerName, role: 'participant', roomCode };
      socket.join(roomCode);
      io.to(roomCode).emit('player_joined', {
        players: rooms[roomCode].participants.map(id => users[id].name),
        rules: rooms[roomCode].rules,
        timeLimit: rooms[roomCode].timeLimit
      });
    } else {
      socket.emit('error', 'Комната не найдена или игра уже началась');
    }
  });

  socket.on('start_quiz', ({ roomCode }) => {
    if (rooms[roomCode]) {
      rooms[roomCode].status = 'active';
      rooms[roomCode].currentQ = 0;
      io.to(roomCode).emit('quiz_started', {
        question: rooms[roomCode].questions[0],
        totalQuestions: rooms[roomCode].questions.length,
        timeLimit: rooms[roomCode].timeLimit
      });
    }
  });

  socket.on('submit_answer', ({ roomCode, answerIndex, answerIndices }) => {
    const user = users[socket.id];
    const room = rooms[roomCode];
    if (room && user.role === 'participant') {
      const currentQuestion = room.questions[room.currentQ];
      let isCorrect = false;

      if (currentQuestion.multiple) {
        const selected = (answerIndices || []).sort();
        const correct = (currentQuestion.correctAnswerIndices || []).sort();
        isCorrect = selected.length === correct.length && 
                    selected.every((val, idx) => val === correct[idx]);
      } else {
        isCorrect = answerIndex === currentQuestion.correctAnswerIndex;
      }

      if (isCorrect) {
        room.scores[socket.id] += 10;
      }
      socket.emit('answer_received', { isCorrect });
    }
  });

  socket.on('next_question', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (room) {
      room.currentQ += 1;
      if (room.currentQ < room.questions.length) {
        io.to(roomCode).emit('quiz_started', {
          question: room.questions[room.currentQ],
          totalQuestions: room.questions.length,
          currentQuestionNumber: room.currentQ + 1,
          timeLimit: room.timeLimit
        });
      } else {
        room.status = 'finished';
        const leaderboard = room.participants.map(id => ({
          name: users[id].name,
          score: room.scores[id]
        })).sort((a, b) => b.score - a.score);
        io.to(roomCode).emit('quiz_finished', { leaderboard });
      }
    }
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      const room = rooms[user.roomCode];
      if (room) {
        room.participants = room.participants.filter(id => id !== socket.id);
        io.to(user.roomCode).emit('player_joined', {
          players: room.participants.map(id => users[id].name),
          rules: room.rules,
          timeLimit: room.timeLimit
        });
      }
      delete users[socket.id];
    }
  });
});

server.listen(3001, () => console.log('Server running on port 3001'));