# 🐌 Snail Race Fundraiser Game

An interactive snail racing game created for **Newcomb & District Cricket Club** fundraising events!

## Features

### 🏁 Race Features
- **6 animated racing snails** with smooth animations
- **Customizable snail names** (name them after players, sponsors, or anything!)
- **Variable race speeds** (slow, medium, fast)
- **Real-time race animations** with exciting visuals
- **Winner celebrations** with special effects

### 💰 Fundraising Features
- **Sponsorship tracking** for each snail
- **Live donation counter** showing total raised
- **Sponsor count per snail** displayed during races
- **Race history** tracking all winners and their sponsors

### 🎮 Moderator Controls
- **Start/Stop/Reset races** with one click
- **Customize snail names** before each race
- **Adjust race speed** for variety
- **Track sponsorships** as people donate
- **View race history** of all past races
- **New Round** button to reset sponsorships

### 📱 Display Options
- **Fully responsive** - works on phones, tablets, and large displays
- **Dual-screen capable** - display on projector while controlling from tablet
- **Cricket club themed** with green colors and professional design

## Setup Instructions

### Quick Start (No Installation Required!)

1. **Download the files:**
   - `index.html`
   - `style.css`
   - `script.js`

2. **Place all three files in the same folder**

3. **Open `index.html` in any web browser:**
   - Double-click the file, OR
   - Right-click → Open with → Your browser (Chrome, Firefox, Safari, Edge, etc.)

4. **That's it!** The game is ready to use!

### For Best Results at Events

#### Option 1: Single Device
- Open the game on a tablet or laptop
- People can gather around to watch and participate

#### Option 2: Dual Display (Recommended for Large Events)
1. **Main Display (Projector/TV):**
   - Open `index.html` in a browser
   - Press `F11` for fullscreen mode
   - This shows the race to everyone

2. **Moderator Device (Laptop/Tablet):**
   - Open `index.html` in another browser/device
   - Scroll down to the moderator controls
   - Use this to control the races and track donations

#### Option 3: Host on Local Network
If you want multiple devices to access simultaneously:
1. Install Python (if not already installed)
2. Open terminal/command prompt in the game folder
3. Run: `python -m http.server 8000` (or `python3 -m http.server 8000`)
4. On other devices, go to: `http://[YOUR-IP]:8000`

## How to Use During Your Fundraiser

### Before the Event
1. **Customize Snail Names:**
   - Use cricket player names
   - Use sponsor company names
   - Use funny/creative names
   - Update names between races!

2. **Test the Setup:**
   - Run a practice race
   - Verify the display looks good on your screen/projector
   - Test the sponsorship tracking

### During the Event

#### Step 1: Pre-Race Setup
1. **Update snail names** in the moderator panel
2. Click "Update Names"
3. **Collect sponsorships:**
   - People choose which snail to sponsor (donate for)
   - Enter the snail number and donation amount
   - Click "Add Sponsor"
   - Watch the total raised increase!

#### Step 2: Race Time!
1. **Announce the race** to your crowd
2. **Click "Start Race"** button (or press spacebar)
3. **Watch the excitement!** Snails race to the finish
4. **Winner is announced** with celebration animation
5. Race result is saved to history

#### Step 3: Next Race
- **Click "Reset Race"** to run the same setup again
- **Click "New Round"** to start fresh (clears sponsorships)
- **Update snail names** for variety

### Fundraising Tips

1. **Encourage Sponsorships:**
   - "Pick your snail and support it with a donation!"
   - Minimum donation of $5 or $10
   - Higher donations = more chances? (your choice!)

2. **Multiple Races:**
   - Run several races throughout the event
   - Change names between races for variety
   - Create tournaments with winners racing again

3. **Prizes:**
   - Offer small prizes for winning sponsors
   - Cricket club merchandise
   - Free raffle entries

4. **Engagement:**
   - Let people name snails for higher donations
   - Create team snails (families, friend groups)
   - Announce sponsors before each race

## Keyboard Shortcuts

- **Spacebar** - Start race
- **R** - Reset race

## Customization

### Change Colors
Edit `style.css`:
- Line 9-11: Background gradient colors
- Search for `#1e5128`, `#2d6a4f`, `#40916c` (cricket greens)
- Replace with your club colors!

### Change Number of Snails
To add/remove snails:
1. Edit `index.html` - add/remove lane sections
2. Edit `script.js` - change the loop `for (let i = 1; i <= 6; i++)` to your number
3. Edit the dropdown in HTML for sponsor selection

### Add Club Logo
Add this in `index.html` inside the `<header>`:
```html
<img src="your-logo.png" alt="Club Logo" style="width: 100px; margin-bottom: 10px;">
```

## Troubleshooting

### Race won't start
- Make sure you clicked "Start Race" or pressed spacebar
- Check if a race is already running - click "Reset" first

### Snails not moving
- Refresh the page (F5)
- Make sure all three files are in the same folder
- Try a different web browser

### Display looks weird
- Adjust browser zoom (Ctrl/Cmd + or -)
- Try fullscreen mode (F11)
- Ensure screen resolution is at least 1024x768

### Sponsorship not adding
- Make sure you entered a valid amount
- Check that you selected the correct snail number

## Technical Details

- **No internet required** - runs completely offline
- **No installation needed** - just open HTML file
- **Works on all devices** - phones, tablets, laptops, desktops
- **Modern browsers** - Chrome, Firefox, Safari, Edge (last 2 years)
- **Lightweight** - under 50KB total
- **No database** - all data stored in memory (resets on page refresh)

## Browser Compatibility

✅ Chrome/Edge (v90+)
✅ Firefox (v88+)
✅ Safari (v14+)
✅ Mobile browsers (iOS Safari, Chrome Mobile)

## Support

Created for Newcomb & District Cricket Club fundraising events.

For questions or issues:
- Check the troubleshooting section above
- Test in a different web browser
- Ensure all files are in the same folder

## Ideas for Future Events

- 🏆 Create a championship tournament
- 🎭 Theme races (player names, sponsors, etc.)
- 📊 Track total raised across multiple events
- 🎪 Combine with other fundraising activities
- 📸 Project on big screen while people donate on phones

## Have Fun and Raise Money!

Good luck with your fundraiser! 🏏🐌💰

---

Made with ❤️ for Newcomb & District Cricket Club
