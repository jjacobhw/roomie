// The app's color palette. Screens and components use these names instead of hex
// values, so the whole look can be changed by editing the values below.
export const colors = {
  // Brand
  primary: '#286A54', // header icon, my bubbles, send button, links
  primaryDisabled: '#A9BDB2', // send button when it can't be pressed
  primarySoft: '#E4F0E9', // selected-user pill
  onPrimary: '#FFFFFF', // text/icons on top of the primary color

  // Surfaces
  background: '#F8F8F6', // behind everything
  surface: '#FFFFFF', // header, composer area, their bubbles
  surfaceMuted: '#F2F3F0', // unselected pills, text input
  border: '#ECECE8',

  // Text
  text: '#202521', // titles and message text
  textMuted: '#777D75', // sender names, subtitles
  textFaint: '#969A93', // timestamps, labels, placeholders, footnote

  // Status
  error: '#B3402E',
  online: '#55A77B',

  // Avatar for other people's messages
  avatarBackground: '#DDE8E0',
  avatarText: '#3E6B51',
} as const;
