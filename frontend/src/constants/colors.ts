// The app's color palette. Screens and components use these names instead of hex
// values, so the whole look can be changed by editing the values below.
// Theme: Home (blue = main, green = people, brown = warm neutrals)
export const colors = {
  // Brand
  primary: '#2E6F95', // header icon, my bubbles, send button, links
  primaryDisabled: '#A9C4D6', // send button when it can't be pressed
  primarySoft: '#DCEAF3', // selected-user pill
  onPrimary: '#FFFFFF', // text/icons on top of the primary color

  // Surfaces
  background: '#FAF6F0', // behind everything
  surface: '#FFFFFF', // header, composer area, their bubbles
  surfaceMuted: '#F1EAE0', // unselected pills, text input
  border: '#E6DCCD',

  // Text
  text: '#3B2A20', // titles and message text
  textMuted: '#7A6556', // sender names, subtitles
  textFaint: '#A8978A', // timestamps, labels, placeholders, footnote

  // Status
  error: '#B3402E',
  online: '#5A9E5F',

  // Avatar for other people's messages
  avatarBackground: '#DDEBDD',
  avatarText: '#3F6B3F',
} as const;
