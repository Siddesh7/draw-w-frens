// server.ts

import { Server, Socket } from "socket.io";
import { createServer } from "http";
import { v4 as uuidv4 } from "uuid";

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*", // Consider restricting this in production (e.g., your frontend URL)
    methods: ["GET", "POST"],
  },
  // Optional: Increase ping interval/timeout if needed for less stable connections
  // pingInterval: 10000,
  // pingTimeout: 5000,
});

interface Room {
  players: string[]; // List of active players who have joined the socket room
  admin: string; // Wallet address of the creator/admin
  currentDrawer: string;
  currentWord: string;
  scores: Record<string, number>;
  round: number;
  maxRounds: number;
  usedWords: string[];
  gameStarted: boolean;
  timer?: NodeJS.Timeout;
  roundStartTime: number;
  // Track players who disconnected *after joining* for potential rejoin
  disconnectedPlayers: Record<
    string,
    { disconnectTime: number; socketId: string | null }
  >;
  isPublic?: boolean;
}

const rooms: Record<string, Room> = {};
const playerSocketMap: Record<string, string> = {}; // Map username (address) to socket.id
const MAX_PLAYERS_PER_ROOM = 10;
const MIN_PLAYERS_PER_ROOM = 1; // Set to 1 for easy testing, use 2+ for real games

// --- Word List ---
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
  "computer",
  "keyboard",
  "mouse",
  "monitor",
  "cloud",
  "sun",
  "moon",
  "star",
  "rain",
  "snow",
  "wind",
  "fire",
  "earth",
  "water",
  "tree",
  "leaf",
  "grass",
  "stone",
  "sand",
  "beach",
]; // Added a few more common words

// --- Helper Functions ---
function shuffleArray(array: string[]): string[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
const shuffledWords = shuffleArray(words);

function getRoomIdFromSocket(socket: Socket): string | null {
  const currentRooms = Array.from(socket.rooms);
  return currentRooms.find((room) => room !== socket.id) || null;
}

// --- Socket Connection Handling ---
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  const connectedAddress = socket.handshake.query.address as string | null; // Get address from query
  let currentUsername: string | null = connectedAddress; // Use address as username
  let currentRoomId: string | null = null; // Track room associated with THIS socket instance

  if (currentUsername) {
    playerSocketMap[currentUsername] = socket.id; // Map address to socket ID
    console.log(
      `Associated username ${currentUsername} with socket ${socket.id}`
    );
  } else {
    console.warn(
      `Socket ${socket.id} connected without an address. Query:`,
      socket.handshake.query
    );
    // Optional: Disconnect if address is mandatory for your logic
    // socket.disconnect(true);
    // return;
  }

  // --- Event Handlers ---

  socket.on("createRoom", ({ username }: { username: string }) => {
    if (!username || username !== connectedAddress) {
      console.error(
        `createRoom failed: Invalid username (${username}) or mismatch with connection address (${connectedAddress})`
      );
      socket.emit("joinError", "Authentication error creating room.");
      return;
    }
    const newRoomId = uuidv4().substring(0, 8); // Generate short room ID
    rooms[newRoomId] = {
      players: [], // Creator does NOT join players list automatically
      admin: username, // Set creator as admin
      currentDrawer: "",
      currentWord: "",
      scores: {}, // Initialize empty scores object
      round: 0,
      maxRounds: 3,
      usedWords: [],
      gameStarted: false,
      roundStartTime: 0,
      disconnectedPlayers: {},
    };
    currentRoomId = newRoomId; // Track room for this socket session
    console.log(
      `Room ${newRoomId} created by admin ${username} (Socket ${socket.id}). Waiting for deposit & join.`
    );
    socket.emit("roomCreated", { roomId: newRoomId }); // Send confirmation back to creator
  });

  socket.on(
    "joinRoom",
    ({ roomId, username }: { roomId: string; username: string }) => {
      console.log(
        `Attempting joinRoom: User ${username}, Room ${roomId}, Socket ${socket.id}`
      );
      const room = rooms[roomId];

      if (!username || username !== connectedAddress) {
        console.error(
          `joinRoom failed: Invalid username (${username}) or mismatch with connection address (${connectedAddress})`
        );
        socket.emit("joinError", "Authentication error joining room.");
        return;
      }

      if (!room) {
        console.error(`joinRoom failed: Room ${roomId} not found.`);
        socket.emit("joinError", "Room not found.");
        return;
      }

      const disconnectedInfo = room.disconnectedPlayers[username];
      const isRejoining = !!disconnectedInfo;

      if (room.gameStarted && !isRejoining) {
        console.warn(`joinRoom rejected: Room ${roomId} game already started.`);
        socket.emit("joinError", "Game is already in progress.");
        return;
      }

      if (
        room.players.length >= MAX_PLAYERS_PER_ROOM &&
        !room.players.includes(username) &&
        !isRejoining
      ) {
        console.warn(`joinRoom rejected: Room ${roomId} is full.`);
        socket.emit("joinError", "Room is full.");
        return;
      }

      // --- Join Success ---
      socket.join(roomId);
      currentRoomId = roomId; // Associate this socket instance with the joined room
      playerSocketMap[username] = socket.id; // Ensure map is up-to-date

      if (isRejoining) {
        delete room.disconnectedPlayers[username]; // Remove disconnect marker
        console.log(
          `Player ${username} rejoined room ${roomId} (Socket ${socket.id})`
        );
        if (!room.players.includes(username)) {
          // Add back to list if somehow removed
          room.players.push(username);
          room.scores[username] = room.scores[username] || 0;
        }
      } else if (!room.players.includes(username)) {
        // Add new player
        room.players.push(username);
        room.scores[username] = 0; // Initialize score
        console.log(
          `Player ${username} added to room ${roomId} (Socket ${socket.id}). Players: ${room.players.length}`
        );
      } else {
        console.log(
          `Player ${username} already listed in room ${roomId}, ensuring socket association updated.`
        );
      }

      // Confirm join to the joining socket
      socket.emit("joinedRoom", {
        roomId: roomId,
        players: room.players,
        scores: room.scores,
        admin: room.admin,
      });
      console.log(
        `Emitted 'joinedRoom' to ${username} (${socket.id}) for ${roomId}`
      );

      // Update everyone else in the room
      socket.to(roomId).emit("playersUpdate", {
        players: room.players,
        scores: room.scores,
        admin: room.admin,
      });
      console.log(`Emitted 'playersUpdate' to others in room ${roomId}`);

      // Send game state if rejoining an active game
      if (room.gameStarted && isRejoining) {
        const timeLeft = Math.max(
          0,
          90 - Math.round((Date.now() - room.roundStartTime) / 1000)
        );
        console.log(
          `Sending current game state to rejoining player ${username}`
        );
        socket.emit("startDrawing", {
          drawer: room.currentDrawer,
          word:
            room.currentDrawer === username
              ? room.currentWord
              : "_".repeat(room.currentWord?.length || 0), // Handle empty word case
          round: room.round,
          maxRounds: room.maxRounds,
          time: timeLeft,
        });
        // You could also send recent guesses here if needed
        // socket.emit('loadGuesses', room.recentGuesses || []);
      }
    }
  );

  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) {
      console.error(`startGame failed: Room ${roomId} not found.`);
      socket.emit("gameError", "Room not found.");
      return;
    }
    if (!currentUsername || room.admin !== currentUsername) {
      console.warn(
        `startGame rejected: User ${currentUsername} is not admin of room ${roomId}`
      );
      socket.emit("gameError", "Only the admin can start the game.");
      return;
    }
    if (room.gameStarted) {
      console.log(`startGame ignored: Game already started in room ${roomId}`);
      return;
    }
    if (room.players.length < MIN_PLAYERS_PER_ROOM) {
      console.warn(`startGame rejected: Not enough players in room ${roomId}`);
      io.to(roomId).emit(
        "gameError",
        `Need at least ${MIN_PLAYERS_PER_ROOM} players to start.`
      );
      return;
    }

    // --- Start Game Success ---
    room.gameStarted = true;
    room.round = 0; // Reset game progress
    room.usedWords = [];
    Object.keys(room.scores).forEach((player) => (room.scores[player] = 0)); // Reset scores
    console.log(`Admin ${currentUsername} starting game in room ${roomId}`);
    io.to(roomId).emit("gameStarted"); // Notify all players
    startNewRound(roomId); // Start the first round
  });

  socket.on("draw", ({ roomId, x, y, type }) => {
    const room = rooms[roomId];
    if (
      !room ||
      !room.gameStarted ||
      socket.id !== playerSocketMap[room.currentDrawer]
    )
      return; // Basic validation: room exists, game started, sender is drawer
    socket.to(roomId).emit("draw", { x, y, type }); // Broadcast drawing data
  });

  socket.on("guess", ({ roomId, guess, username }) => {
    const room = rooms[roomId];
    if (
      !room ||
      !room.gameStarted ||
      !username ||
      !guess ||
      username !== connectedAddress
    )
      return; // Basic validation

    if (username === room.currentDrawer) {
      // console.log(`Guess ignored: Drawer ${username} cannot guess.`);
      // socket.emit("systemMessage", "You cannot guess your own drawing!"); // Optional feedback
      return;
    }

    const formattedGuess = `${username.slice(0, 6)}...: ${guess.trim()}`;
    io.to(roomId).emit("guessUpdate", formattedGuess); // Broadcast the guess to everyone

    // Check if guess is correct (case-insensitive)
    if (guess.trim().toLowerCase() === room.currentWord?.toLowerCase()) {
      const timeSpent = Math.max(
        1,
        Math.round((Date.now() - room.roundStartTime) / 1000)
      );
      const roundDuration = 90;
      const guesserScore = Math.max(
        10,
        Math.round(1000 * ((roundDuration - timeSpent) / roundDuration))
      );
      const drawerScore = Math.max(5, Math.round(guesserScore * 0.5));

      room.scores[username] = (room.scores[username] || 0) + guesserScore;
      // Ensure drawer score entry exists even if somehow missing
      room.scores[room.currentDrawer] =
        (room.scores[room.currentDrawer] || 0) + drawerScore;

      console.log(
        `Correct guess in room ${roomId} by ${username}. Guesser:${guesserScore}, Drawer:${drawerScore}`
      );
      endRound(roomId, username); // End round, pass username of guesser
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(
      `Socket ${socket.id} disconnected. Reason: ${reason}. User: ${currentUsername}`
    );
    // Find the room associated with this specific socket instance using currentRoomId tracked in closure
    const roomId = currentRoomId;

    if (roomId && currentUsername && rooms[roomId]) {
      const room = rooms[roomId];
      console.log(
        `Handling disconnect for ${currentUsername} in room ${roomId}`
      );

      // Only mark if they were actually in the players list (i.e., had joined)
      if (room.players.includes(currentUsername)) {
        room.disconnectedPlayers[currentUsername] = {
          disconnectTime: Date.now(),
          socketId: socket.id, // Store the socket ID that disconnected
        };
        delete playerSocketMap[currentUsername]; // Remove from active map

        // --- Timeout for Permanent Removal ---
        const removalTimeout = 30000; // 30 seconds to reconnect
        console.log(
          `Setting ${
            removalTimeout / 1000
          }s removal timeout for ${currentUsername} in ${roomId}`
        );

        setTimeout(() => {
          if (
            rooms[roomId] &&
            rooms[roomId].disconnectedPlayers[currentUsername!]?.socketId ===
              socket.id
          ) {
            console.log(
              `Disconnect timeout reached for ${currentUsername} in ${roomId}. Removing.`
            );
            const currentRoomState = rooms[roomId]; // Get fresh room state

            const playerIndex = currentRoomState.players.indexOf(
              currentUsername!
            );
            if (playerIndex > -1) {
              currentRoomState.players.splice(playerIndex, 1);
              console.log(
                `Removed ${currentUsername} from players list in ${roomId}`
              );
            }
            delete currentRoomState.disconnectedPlayers[currentUsername!];

            io.to(roomId).emit("playersUpdate", {
              // Update remaining players
              players: currentRoomState.players,
              scores: currentRoomState.scores,
              admin: currentRoomState.admin,
            });

            // Admin change logic
            if (
              currentRoomState.admin === currentUsername &&
              currentRoomState.players.length > 0
            ) {
              currentRoomState.admin = currentRoomState.players[0];
              console.log(`New admin for ${roomId}: ${currentRoomState.admin}`);
              io.to(roomId).emit(
                "systemMessage",
                `Admin left. ${currentRoomState.admin.slice(
                  0,
                  6
                )}... is new admin.`
              );
              io.to(roomId).emit("playersUpdate", {
                // Emit update again with new admin
                players: currentRoomState.players,
                scores: currentRoomState.scores,
                admin: currentRoomState.admin,
              });
            }

            // Game state check
            if (
              currentRoomState.gameStarted &&
              currentRoomState.players.length < MIN_PLAYERS_PER_ROOM
            ) {
              console.log(`Not enough players left in ${roomId}. Ending game.`);
              endGame(roomId, "Not enough players");
            } else if (
              !currentRoomState.gameStarted &&
              currentRoomState.players.length === 0
            ) {
              console.log(`Room ${roomId} empty & inactive. Deleting.`);
              if (currentRoomState.timer) clearTimeout(currentRoomState.timer);
              delete rooms[roomId];
            } else if (
              currentRoomState.gameStarted &&
              currentRoomState.currentDrawer === currentUsername
            ) {
              console.log(
                `Drawer ${currentUsername} disconnected in ${roomId}. Ending round.`
              );
              io.to(roomId).emit(
                "systemMessage",
                `Drawer (${currentUsername!.slice(0, 6)}...) disconnected.`
              );
              endRound(roomId, "Drawer disconnected"); // End the current round
            }
          } else {
            // Player either reconnected or was already removed by another process
            // console.log(`Disconnect timeout check: ${currentUsername} reconnected or already removed from ${roomId}`);
          }
        }, removalTimeout);
      } else {
        console.log(
          `User ${currentUsername} disconnected from ${roomId} but wasn't in active players list.`
        );
      }
    } else {
      // This socket wasn't associated with a known room when it disconnected
      if (currentUsername && playerSocketMap[currentUsername] === socket.id) {
        // Clean up map if this was the last known socket for the user
        delete playerSocketMap[currentUsername];
      }
      console.log(
        `Socket ${socket.id} (User: ${currentUsername}) disconnected without active room association.`
      );
    }
    // Clear closure variables specific to this connection instance
    currentRoomId = null;
  });

  socket.on("error", (err) => {
    console.error(
      `Socket Error (Socket: ${socket.id}, User: ${currentUsername}, Room: ${currentRoomId}):`,
      err
    );
  });
}); // End io.on("connection")

// --- Game Logic Functions ---

function startNewRound(roomId: string) {
  const room = rooms[roomId];
  if (!room || !room.gameStarted) {
    console.error(
      `startNewRound failed for ${roomId}: Room not found or game not started.`
    );
    return;
  }
  if (room.timer) clearTimeout(room.timer);

  if (room.players.length < MIN_PLAYERS_PER_ROOM) {
    console.log(
      `Cannot start round in ${roomId}: Only ${room.players.length} players.`
    );
    endGame(roomId, "Not enough players");
    return;
  }

  room.round += 1;
  console.log(`Starting Round ${room.round}/${room.maxRounds} in ${roomId}`);

  // Simple rotation for drawer selection
  const currentDrawerIndex = room.players.indexOf(room.currentDrawer);
  const nextDrawerIndex = (currentDrawerIndex + 1) % room.players.length;
  room.currentDrawer = room.players[nextDrawerIndex];

  // Select word, avoiding recent ones
  let availableWords = shuffledWords.filter(
    (word) => !room.usedWords.includes(word)
  );
  if (availableWords.length === 0) {
    console.log(`Resetting used words for ${roomId}`);
    room.usedWords = []; // Reset if exhausted
    availableWords = shuffledWords;
  }
  room.currentWord =
    availableWords[Math.floor(Math.random() * availableWords.length)];
  room.usedWords.push(room.currentWord);
  if (room.usedWords.length > words.length * 0.75) {
    // Keep ~25% buffer
    room.usedWords.shift(); // Remove oldest word if list gets long
  }
  console.log(
    `New word for ${roomId}: ${room.currentWord} (Drawer: ${room.currentDrawer})`
  );

  // Start round timer
  const roundDuration = 90 * 1000;
  room.roundStartTime = Date.now();

  // Emit 'startDrawing' individually to send correct word/underscores
  room.players.forEach((playerUsername) => {
    const playerSocketId = playerSocketMap[playerUsername];
    if (playerSocketId) {
      const socketToSendTo = io.sockets.sockets.get(playerSocketId);
      if (socketToSendTo) {
        const wordToSend =
          playerUsername === room.currentDrawer
            ? room.currentWord
            : "_".repeat(room.currentWord.length);
        socketToSendTo.emit("startDrawing", {
          drawer: room.currentDrawer,
          word: wordToSend,
          round: room.round,
          maxRounds: room.maxRounds,
          time: 90,
        });
      } else {
        console.warn(
          `Could not find socket instance for player ${playerUsername} (${playerSocketId}) in room ${roomId}`
        );
      }
    } else {
      console.warn(
        `Could not find socket ID for player ${playerUsername} in room ${roomId}`
      );
    }
  });

  // Server-side timer tick
  function tick() {
    // Check validity before proceeding
    if (
      !rooms[roomId] ||
      !rooms[roomId].gameStarted ||
      rooms[roomId].roundStartTime !== room.roundStartTime
    ) {
      // console.log(`Timer tick stopped for ${roomId}: Conditions invalid.`);
      return;
    }
    const elapsed = Date.now() - room.roundStartTime;
    const timeLeft = Math.max(0, Math.round((roundDuration - elapsed) / 1000));
    io.to(roomId).emit("timeUpdate", timeLeft); // Broadcast time

    if (timeLeft <= 0) {
      console.log(
        `Time up for round ${room.round} in ${roomId}. Word: ${room.currentWord}`
      );
      endRound(roomId, "Time's up! No one");
    } else {
      room.timer = setTimeout(tick, 1000); // Schedule next tick
    }
  }
  room.timer = setTimeout(tick, 1000); // Start the first tick
}

function endRound(roomId: string, winnerUsernameOrReason: string) {
  const room = rooms[roomId];
  if (!room) return; // Room might have been deleted

  if (room.timer) clearTimeout(room.timer);
  room.timer = undefined;

  console.log(
    `Ending Round ${room.round} in ${roomId}. Trigger: ${winnerUsernameOrReason}`
  );

  io.to(roomId).emit("roundEnd", {
    winner: winnerUsernameOrReason, // Username, "Time's up! No one", "Drawer disconnected"
    word: room.currentWord,
    scores: room.scores,
  });

  if (room.round >= room.maxRounds) {
    endGame(roomId);
  } else {
    if (room.players.length < MIN_PLAYERS_PER_ROOM) {
      endGame(roomId, "Not enough players");
    } else {
      console.log(`Scheduling next round for ${roomId} in 3s`);
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].gameStarted) startNewRound(roomId);
      }, 3000);
    }
  }
}

function endGame(roomId: string, reason: string | null = null) {
  const room = rooms[roomId];
  if (!room) return;

  console.log(`Ending game in ${roomId}. Reason: ${reason || "Max rounds"}`);

  if (room.timer) clearTimeout(room.timer);
  room.timer = undefined;
  room.gameStarted = false;

  const finalWinner = getWinner(room.scores);

  io.to(roomId).emit("gameEnd", {
    scores: room.scores,
    winner: finalWinner, // Can be null if no scores
    reason: reason,
  });

  // Don't delete room immediately, allow viewing scores
  console.log(`Game ended. Room ${roomId} state kept for viewing.`);
}

function getWinner(scores: Record<string, number>): string | null {
  let winner: string | null = null;
  let maxScore = -1; // Start below 0 in case of only negative scores (unlikely here)
  if (!scores || Object.keys(scores).length === 0) return null;

  for (const [player, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      winner = player;
    }
  }
  return winner; // Returns null if no players or all scores <= 0
}

// --- Start Server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
