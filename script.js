// Snail Race Game - Newcomb & District Cricket Club
// Game State
const gameState = {
    racing: false,
    snails: [],
    raceInterval: null,
    raceSpeed: 10000, // milliseconds
    totalRaised: 0,
    raceHistory: [],
    raceNumber: 0,
    sponsorships: {
        1: { count: 0, amount: 0 },
        2: { count: 0, amount: 0 },
        3: { count: 0, amount: 0 },
        4: { count: 0, amount: 0 },
        5: { count: 0, amount: 0 },
        6: { count: 0, amount: 0 }
    }
};

// Initialize snails
function initializeSnails() {
    gameState.snails = [];
    for (let i = 1; i <= 6; i++) {
        const snailElement = document.getElementById(`snail${i}`);
        gameState.snails.push({
            id: i,
            element: snailElement,
            position: 0,
            speed: 0,
            finished: false,
            finishPosition: 0
        });
    }
}

// Update total raised display
function updateTotalRaised() {
    document.getElementById('totalRaised').textContent = gameState.totalRaised.toFixed(2);
}

// Update sponsor counts
function updateSponsorDisplay() {
    for (let i = 1; i <= 6; i++) {
        const snail = document.getElementById(`snail${i}`);
        const sponsorCountElement = snail.querySelector('.sponsor-count');
        sponsorCountElement.textContent = gameState.sponsorships[i].count;
    }
}

// Add sponsor
function addSponsor() {
    const snailNumber = parseInt(document.getElementById('sponsorSnail').value);
    const amount = parseFloat(document.getElementById('sponsorAmount').value);

    if (amount && amount > 0) {
        gameState.sponsorships[snailNumber].count++;
        gameState.sponsorships[snailNumber].amount += amount;
        gameState.totalRaised += amount;

        updateSponsorDisplay();
        updateTotalRaised();

        // Visual feedback
        showNotification(`$${amount} added to Snail ${snailNumber}! 🎉`);

        // Reset amount
        document.getElementById('sponsorAmount').value = 10;
    }
}

// Show notification
function showNotification(message) {
    const status = document.getElementById('raceStatus');
    const originalText = status.textContent;
    status.textContent = message;
    status.style.background = 'rgba(46, 196, 182, 0.3)';

    setTimeout(() => {
        status.textContent = originalText;
        status.style.background = 'rgba(255, 255, 255, 0.1)';
    }, 2000);
}

// Update snail names
function updateSnailNames() {
    for (let i = 1; i <= 6; i++) {
        const nameInput = document.getElementById(`name${i}`);
        const snailElement = document.getElementById(`snail${i}`);
        const nameDisplay = snailElement.querySelector('.snail-name');

        if (nameInput.value.trim()) {
            nameDisplay.textContent = nameInput.value.trim();
        }
    }
    showNotification('Snail names updated! 🐌');
}

// Start race
function startRace() {
    if (gameState.racing) return;

    gameState.racing = true;
    gameState.raceNumber++;

    // Update UI
    document.getElementById('startRace').disabled = true;
    document.getElementById('raceStatus').textContent = 'Racing! 🏁';
    document.getElementById('winnerAnnouncement').classList.remove('show');

    // Reset snails
    gameState.snails.forEach(snail => {
        snail.position = 0;
        snail.finished = false;
        snail.finishPosition = 0;
        snail.element.classList.add('racing');
        snail.element.classList.remove('winner');

        // Assign random speed (with some variation for excitement)
        snail.speed = Math.random() * 0.5 + 0.5; // Between 0.5 and 1.0
    });

    // Get race speed from settings
    const speedSetting = document.getElementById('raceSpeed').value;
    switch(speedSetting) {
        case 'slow':
            gameState.raceSpeed = 15000;
            break;
        case 'medium':
            gameState.raceSpeed = 10000;
            break;
        case 'fast':
            gameState.raceSpeed = 7000;
            break;
    }

    // Start race animation
    const startTime = Date.now();
    const trackWidth = document.querySelector('.race-track').offsetWidth - 200; // Account for finish line and margins
    let finishOrder = 0;

    gameState.raceInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / gameState.raceSpeed, 1);

        let allFinished = true;

        gameState.snails.forEach(snail => {
            if (!snail.finished) {
                // Add some randomness to make it more exciting
                const randomFactor = Math.random() * 0.1 + 0.95; // 0.95 to 1.05
                snail.position = (progress * snail.speed * randomFactor) * 100;

                // Check if finished
                if (snail.position >= 95) {
                    snail.position = 95;
                    if (!snail.finished) {
                        snail.finished = true;
                        finishOrder++;
                        snail.finishPosition = finishOrder;

                        // Winner!
                        if (finishOrder === 1) {
                            snail.element.classList.add('winner');
                            announceWinner(snail);
                        }
                    }
                } else {
                    allFinished = false;
                }

                // Update position
                snail.element.style.left = `${60 + (snail.position / 100) * trackWidth}px`;
            }
        });

        // End race when all finished
        if (allFinished) {
            endRace();
        }
    }, 50);
}

// Announce winner
function announceWinner(snail) {
    const winnerName = snail.element.querySelector('.snail-name').textContent;
    const winnerAnnouncement = document.getElementById('winnerAnnouncement');
    winnerAnnouncement.textContent = `🏆 ${winnerName} WINS! 🏆`;
    winnerAnnouncement.classList.add('show');

    document.getElementById('raceStatus').textContent = `${winnerName} is the winner!`;

    // Add to race history
    addToRaceHistory(snail);
}

// Add to race history
function addToRaceHistory(winningSnail) {
    const winnerName = winningSnail.element.querySelector('.snail-name').textContent;
    const sponsorInfo = gameState.sponsorships[winningSnail.id];

    const historyItem = {
        raceNumber: gameState.raceNumber,
        winner: winnerName,
        snailNumber: winningSnail.id,
        sponsors: sponsorInfo.count,
        amount: sponsorInfo.amount
    };

    gameState.raceHistory.unshift(historyItem);

    // Update history display
    updateRaceHistory();
}

// Update race history display
function updateRaceHistory() {
    const historyContainer = document.getElementById('raceHistory');

    if (gameState.raceHistory.length === 0) {
        historyContainer.innerHTML = '<p class="no-history">No races yet</p>';
        return;
    }

    historyContainer.innerHTML = gameState.raceHistory.map(race => `
        <div class="race-history-item">
            <strong>Race ${race.raceNumber}:</strong> ${race.winner} (Snail ${race.snailNumber}) -
            ${race.sponsors} sponsors ($${race.amount.toFixed(2)})
        </div>
    `).join('');
}

// End race
function endRace() {
    clearInterval(gameState.raceInterval);
    gameState.racing = false;

    gameState.snails.forEach(snail => {
        snail.element.classList.remove('racing');
    });

    document.getElementById('startRace').disabled = false;
}

// Reset race
function resetRace() {
    if (gameState.racing) {
        clearInterval(gameState.raceInterval);
        gameState.racing = false;
    }

    gameState.snails.forEach(snail => {
        snail.position = 0;
        snail.finished = false;
        snail.element.style.left = '60px';
        snail.element.classList.remove('racing', 'winner');
    });

    document.getElementById('raceStatus').textContent = 'Ready to Race!';
    document.getElementById('winnerAnnouncement').classList.remove('show');
    document.getElementById('startRace').disabled = false;
}

// New round (reset everything including sponsorships)
function newRound() {
    resetRace();

    // Reset sponsorships
    for (let i = 1; i <= 6; i++) {
        gameState.sponsorships[i] = { count: 0, amount: 0 };
    }

    updateSponsorDisplay();
    showNotification('New round started! Ready for sponsors! 🎮');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initializeSnails();
    updateSponsorDisplay();
    updateTotalRaised();

    // Race controls
    document.getElementById('startRace').addEventListener('click', startRace);
    document.getElementById('resetRace').addEventListener('click', resetRace);
    document.getElementById('newRound').addEventListener('click', newRound);

    // Snail name updates
    document.getElementById('updateNames').addEventListener('click', updateSnailNames);

    // Sponsorship
    document.getElementById('addSponsor').addEventListener('click', addSponsor);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Space bar to start race
        if (e.code === 'Space' && !gameState.racing) {
            e.preventDefault();
            startRace();
        }
        // R to reset
        if (e.code === 'KeyR' && !gameState.racing) {
            resetRace();
        }
    });
});

// Add some fun animations on page load
window.addEventListener('load', () => {
    document.querySelectorAll('.snail').forEach((snail, index) => {
        snail.style.opacity = '0';
        snail.style.transform = 'translateX(-50px)';

        setTimeout(() => {
            snail.style.transition = 'all 0.5s ease';
            snail.style.opacity = '1';
            snail.style.transform = 'translateX(0)';
        }, index * 100);
    });
});
