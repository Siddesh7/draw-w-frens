import { Server } from "socket.io";
import { createServer } from "http";

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

interface Room {
  players: string[];
  admin: string;
  currentDrawer: string;
  currentWord: string;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  usedWords: string[];
  gameStarted: boolean;
  timer?: NodeJS.Timeout;
  roundStartTime: number;
  disconnectedPlayers: Record<string, number>;
  isPublic?: boolean; // New field to identify public rooms
}

const rooms: Record<string, Room> = {};
const publicRooms: string[] = [];
const MAX_PLAYERS_PER_ROOM = 10;
const MIN_PLAYERS_PER_ROOM = 2;

const words = [
  "apple",
  "banana",
  "carrot",
  "dragon",
  "elephant",
  "flower",
  "guitar",
  "house",
  "island",
  "jacket",
  "kangaroo",
  "lemon",
  "mountain",
  "notebook",
  "ocean",
  "piano",
  "queen",
  "river",
  "snake",
  "tiger",
  "umbrella",
  "volcano",
  "whale",
  "xylophone",
  "yacht",
  "zebra",
  "bridge",
  "castle",
  "desert",
  "forest",
  "garden",
  "harbor",
  "igloo",
  "jungle",
  "lake",
  "meadow",
  "nest",
  "oasis",
  "pond",
  "reef",
  "stream",
  "temple",
  "valley",
  "windmill",
  "bear",
  "cat",
  "deer",
  "eagle",
  "fox",
  "goat",
  "horse",
  "lion",
  "monkey",
  "owl",
  "penguin",
  "rabbit",
  "shark",
  "turtle",
  "wolf",
  "airplane",
  "bicycle",
  "boat",
  "car",
  "drone",
  "helicopter",
  "jet",
  "motorcycle",
  "rocket",
  "ship",
  "train",
  "truck",
  "balloon",
  "compass",
  "flag",
  "globe",
  "key",
  "lamp",
  "map",
  "phone",
  "radio",
  "scissors",
  "sword",
  "telescope",
  "watch",
  "book",
  "chair",
  "clock",
  "door",
  "table",
  "window",
  "bed",
  "couch",
  "mirror",
  "shelf",
  "camera",
  "painting",
  "statue",
  "vase",
  "robot",
];

function shuffleArray(array: string[]): string[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const shuffledWords = shuffleArray(words);

// Schedule public games at 10 AM and 10 PM IST
function schedulePublicGames() {
  const now = new Date();
  const ISTOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const nowIST = new Date(now.getTime() + ISTOffset);

  const next10AM = new Date(nowIST);
  next10AM.setUTCHours(4, 30, 0, 0); // 10 AM IST = 4:30 AM UTC
  if (nowIST > next10AM) next10AM.setDate(next10AM.getDate() + 1);

  const next10PM = new Date(nowIST);
  next10PM.setUTCHours(16, 30, 0, 0); // 10 PM IST = 4:30 PM UTC
  if (nowIST > next10PM) next10PM.setDate(next10PM.getDate() + 1);

  const timeTo10AM = next10AM.getTime() - nowIST.getTime();
  const timeTo10PM = next10PM.getTime() - nowIST.getTime();

  setTimeout(() => startPublicGame("10AM"), timeTo10AM);
  setTimeout(() => startPublicGame("10PM"), timeTo10PM);

  // Reschedule every day
  setInterval(() => startPublicGame("10AM"), 24 * 60 * 60 * 1000);
  setInterval(() => startPublicGame("10PM"), 24 * 60 * 60 * 1000);
}

function startPublicGame(timeSlot: string) {
  const roomId = `public-${timeSlot}-${Date.now()}`;
  rooms[roomId] = {
    players: [],
    admin: "system",
    currentDrawer: "",
    currentWord: "",
    scores: {},
    round: 0,
    maxRounds: 3,
    usedWords: [],
    gameStarted: false,
    roundStartTime: 0,
    disconnectedPlayers: {},
    isPublic: true,
  };
  publicRooms.push(roomId);
  console.log(`Public game room ${roomId} created for ${timeSlot}`);

  // Start game after 60 seconds
  setTimeout(() => {
    if (rooms[roomId] && rooms[roomId].players.length >= MIN_PLAYERS_PER_ROOM) {
      rooms[roomId].gameStarted = true;
      io.to(roomId).emit("gameStarted");
      startNewRound(roomId);
    } else {
      io.to(roomId).emit("gameCancelled", "Not enough players");
      delete rooms[roomId];
      publicRooms.splice(publicRooms.indexOf(roomId), 1);
    }
  }, 60 * 1000); // 60-second buffer
}

schedulePublicGames();

io.on("connection", (socket) => {
  let currentRoomId: string | null = null;
  let currentUsername: string | null = null;

  socket.on("joinPublicGame", ({ username }: { username: string }) => {
    currentUsername = username;
    const availableRoom = publicRooms.find(
      (roomId) =>
        rooms[roomId] &&
        rooms[roomId].isPublic &&
        rooms[roomId].players.length < MAX_PLAYERS_PER_ROOM &&
        !rooms[roomId].gameStarted
    );

    if (availableRoom) {
      currentRoomId = availableRoom;
    } else {
      currentRoomId = `public-${Date.now()}`;
      rooms[currentRoomId] = {
        players: [],
        admin: "system",
        currentDrawer: "",
        currentWord: "",
        scores: {},
        round: 0,
        maxRounds: 3,
        usedWords: [],
        gameStarted: false,
        roundStartTime: 0,
        disconnectedPlayers: {},
        isPublic: true,
      };
      publicRooms.push(currentRoomId);
      setTimeout(() => {
        if (
          currentRoomId &&
          rooms[currentRoomId] &&
          rooms[currentRoomId].players.length >= MIN_PLAYERS_PER_ROOM
        ) {
          rooms[currentRoomId].gameStarted = true;
          io.to(currentRoomId).emit("gameStarted");
          startNewRound(currentRoomId);
        } else {
          io.to(currentRoomId!).emit("gameCancelled", "Not enough players");
          delete rooms[currentRoomId!];
          publicRooms.splice(publicRooms.indexOf(currentRoomId!), 1);
        }
      }, 60 * 1000);
    }

    socket.join(currentRoomId);
    const room = rooms[currentRoomId];
    if (!room.players.includes(username)) {
      room.players.push(username);
      room.scores[username] = 0;
    }

    io.to(currentRoomId).emit("playersUpdate", {
      players: room.players,
      scores: room.scores,
      admin: room.admin,
    });
    socket.emit("joinedPublicGame", { roomId: currentRoomId });
  });

  socket.on(
    "joinRoom",
    ({ roomId, username }: { roomId: string; username: string }) => {
      socket.join(roomId);
      currentRoomId = roomId;
      currentUsername = username;

      if (!rooms[roomId]) {
        rooms[roomId] = {
          players: [],
          admin: username,
          currentDrawer: "",
          currentWord: "",
          scores: {},
          round: 0,
          maxRounds: 3,
          usedWords: [],
          gameStarted: false,
          roundStartTime: 0,
          disconnectedPlayers: {},
        };
      }

      if (rooms[roomId].disconnectedPlayers[username]) {
        delete rooms[roomId].disconnectedPlayers[username];
        console.log(`Player ${username} rejoined room ${roomId}`);
      }

      if (!rooms[roomId].players.includes(username)) {
        rooms[roomId].players.push(username);
        rooms[roomId].scores[username] = rooms[roomId].scores[username] || 0;
        console.log(
          `Player ${username} added to room ${roomId}. Total players: ${rooms[roomId].players.length}`
        );
      } else {
        console.log(
          `Player ${username} already in room ${roomId}, not adding again`
        );
      }

      io.to(roomId).emit("playersUpdate", {
        players: rooms[roomId].players,
        scores: rooms[roomId].scores,
        admin: rooms[roomId].admin,
      });

      if (rooms[roomId].gameStarted && rooms[roomId].round > 0) {
        const timeLeft = Math.max(
          0,
          90 - Math.round((Date.now() - rooms[roomId].roundStartTime) / 1000)
        );
        socket.emit("startDrawing", {
          drawer: rooms[roomId].currentDrawer,
          word:
            rooms[roomId].currentDrawer === username
              ? rooms[roomId].currentWord
              : "_".repeat(rooms[roomId].currentWord.length),
          round: rooms[roomId].round,
          maxRounds: rooms[roomId].maxRounds,
          time: timeLeft,
        });
      }
    }
  );

  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) {
      console.error(`Room ${roomId} does not exist`);
      return;
    }

    if (room.gameStarted) {
      console.log(`Game already started in room ${roomId}`);
      return;
    }

    room.gameStarted = true;
    io.to(roomId).emit("gameStarted");
    console.log(`Game started in room ${roomId}`);
    startNewRound(roomId);
  });

  socket.on("draw", ({ roomId, x, y, type }) => {
    console.log(`Draw event received in room ${roomId}:`, { x, y, type });
    socket.to(roomId).emit("draw", { x, y, type });
  });

  socket.on("guess", ({ roomId, guess, username }) => {
    const room = rooms[roomId];
    if (!room) {
      console.error(`Room ${roomId} does not exist`);
      return;
    }

    console.log(
      `Guess event received in room ${roomId}: ${username}: ${guess}`
    );
    console.log(
      `Current word: ${room.currentWord}, Current drawer: ${room.currentDrawer}`
    );
    io.to(roomId).emit("guessUpdate", `${username}: ${guess}`);

    if (
      guess.toLowerCase() === room.currentWord.toLowerCase() &&
      username !== room.currentDrawer
    ) {
      const timeSpent = Math.round((Date.now() - room.roundStartTime) / 1000);
      const roundDuration = 90;
      const guesserScore = Math.max(
        0,
        Math.round(1000 * (1 - timeSpent / roundDuration))
      );
      const drawerScore = Math.round(guesserScore * 0.5);

      room.scores[username] = (room.scores[username] || 0) + guesserScore;
      room.scores[room.currentDrawer] =
        (room.scores[room.currentDrawer] || 0) + drawerScore;

      console.log(
        `Guess correct in room ${roomId}: ${username} scored ${guesserScore}, ${room.currentDrawer} scored ${drawerScore}`
      );
      endRound(roomId, username);
    } else {
      console.log(
        `Guess incorrect or invalid: ${guess} does not match ${room.currentWord}, or ${username} is the drawer (${room.currentDrawer})`
      );
    }
  });

  socket.on("disconnect", () => {
    console.log(
      `A player disconnected: ${currentUsername} from room ${currentRoomId}`
    );
    if (
      currentRoomId !== null &&
      currentUsername !== null &&
      rooms[currentRoomId]
    ) {
      rooms[currentRoomId].disconnectedPlayers[currentUsername] = Date.now();

      setTimeout(() => {
        if (
          currentRoomId !== null &&
          currentUsername !== null &&
          rooms[currentRoomId] &&
          rooms[currentRoomId].disconnectedPlayers[currentUsername]
        ) {
          const room = rooms[currentRoomId];
          room.players = room.players.filter(
            (player: string) => player !== currentUsername
          );
          delete room.scores[currentUsername];
          io.to(currentRoomId).emit("playersUpdate", {
            players: room.players,
            scores: room.scores,
            admin: room.admin,
          });

          if (room.admin === currentUsername && room.players.length > 0) {
            room.admin = room.players[0];
            console.log(
              `New admin assigned for room ${currentRoomId}: ${room.admin}`
            );
          }

          if (room.players.length === 0) {
            if (room.timer) {
              clearTimeout(room.timer);
            }
            delete rooms[currentRoomId];
            console.log(`Room ${currentRoomId} deleted as no players remain`);
          }
        }
      }, 30000);
    }
  });
});

function startNewRound(roomId: string) {
  const room = rooms[roomId];
  if (!room) {
    console.error(`Room ${roomId} does not exist`);
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
    console.log(`Cleared previous timer for room ${roomId}`);
  }

  room.round += 1;
  if (room.players.length === 0) {
    console.error(`No players in room ${roomId}, cannot start new round`);
    return;
  }
  room.currentDrawer =
    room.players[Math.floor(Math.random() * room.players.length)];

  const availableWords = shuffledWords.filter(
    (word) => !room.usedWords.includes(word)
  );
  if (availableWords.length === 0) {
    room.usedWords = [];
    console.log("All words used, resetting usedWords");
  }
  const newWord =
    availableWords[Math.floor(Math.random() * availableWords.length)];
  room.currentWord = newWord;
  room.usedWords.push(newWord);
  console.log(`New word selected for room ${roomId}: ${newWord}`);

  const roundDuration = 90 * 1000; // 90 seconds in milliseconds
  room.roundStartTime = Date.now();

  io.to(roomId).emit("startDrawing", {
    drawer: room.currentDrawer,
    word: room.currentWord,
    round: room.round,
    maxRounds: room.maxRounds,
    time: 90,
  });
  console.log(`startDrawing emitted for room ${roomId}: { time: 90 }`);

  function tick() {
    const elapsed = Date.now() - room.roundStartTime;
    const timeLeft = Math.max(0, Math.round((roundDuration - elapsed) / 1000));
    console.log(`Timer tick for room ${roomId}: ${timeLeft}s`);
    io.to(roomId).emit("timeUpdate", timeLeft);

    if (timeLeft <= 0) {
      console.log(`Time's up for room ${roomId}`);
      room.scores[room.currentDrawer] =
        (room.scores[room.currentDrawer] || 0) - 50;
      endRound(roomId, "Time's up! No one");
    } else {
      room.timer = setTimeout(tick, 1000);
    }
  }
  tick();
}

function endRound(roomId: string, winner: string) {
  const room = rooms[roomId];
  if (!room) {
    console.error(`Room ${roomId} does not exist`);
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
    console.log(`Timer cleared for room ${roomId} at round end`);
  }

  io.to(roomId).emit("roundEnd", {
    winner,
    word: room.currentWord,
    scores: room.scores,
  });

  if (room.round < room.maxRounds) {
    console.log(`Starting next round for room ${roomId} after 3 seconds`);
    setTimeout(() => startNewRound(roomId), 3000);
  } else {
    console.log(`Game ended for room ${roomId}`);
    io.to(roomId).emit("gameEnd", {
      scores: room.scores,
      winner: getWinner(room.scores),
    });
  }
}

function getWinner(scores: Record<string, number>): string {
  return Object.entries(scores).reduce((a, b) => (a[1] > b[1] ? a : b))[0];
}

server.listen(3001, () => {
  console.log("WebSocket server running on port 3001");
});
