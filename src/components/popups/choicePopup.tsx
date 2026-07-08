#!/usr/bin/env node

/**
 * Standalone popup for choice dialogs
 * Runs in a tmux popup modal and writes result to a file
 */

import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import * as fs from 'fs';
import { PopupContainer, PopupWrapper, writeSuccessAndExit } from './shared/index.js';
import { PopupFooters, POPUP_CONFIG } from './config.js';
import { computeScrollWindow } from '../../utils/scrollWindow.js';

interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
  danger?: boolean;
  default?: boolean;
}

interface ChoicePopupProps {
  resultFile: string;
  title: string;
  message: string;
  options: ChoiceOption[];
  maxVisible?: number;
}

const ChoicePopupApp: React.FC<ChoicePopupProps> = ({
  resultFile,
  title,
  message,
  options,
  maxVisible,
}) => {
  // Find default option or start at 0
  const defaultIndex = options.findIndex(o => o.default) || 0;
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, defaultIndex));
  const { exit } = useApp();

  // Window the list so a long option set (e.g. the ~/git project chooser)
  // never overflows the fixed-height popup — otherwise the highlighted row
  // scrolls off-screen and arrow navigation looks broken.
  const visibleCount = Math.max(1, maxVisible || options.length);
  const { start, end } = computeScrollWindow(selectedIndex, options.length, visibleCount);
  const visibleOptions = options.slice(start, end);
  const moreAbove = start > 0;
  const moreBelow = end < options.length;

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(Math.min(options.length - 1, selectedIndex + 1));
    } else if (key.return) {
      // User selected an option
      const selectedOption = options[selectedIndex];
      writeSuccessAndExit(resultFile, selectedOption.id, exit);
    }
  });

  return (
    <PopupWrapper resultFile={resultFile}>
      <PopupContainer footer={PopupFooters.choice()}>
        {/* Message */}
        {message && (
          <Box marginBottom={1} flexDirection="column">
            {message.split('\n').map((line, idx) => (
              <Box key={idx}>
                <Text wrap="truncate-end">{line}</Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Options — windowed to fit the popup height */}
        <Box flexDirection="column">
          {moreAbove && (
            <Text dimColor>↑ {start} more</Text>
          )}
          {visibleOptions.map((option, idx) => {
            const index = start + idx;
            const isSelected = index === selectedIndex;
            const isLastVisible = idx === visibleOptions.length - 1;
            return (
              <Box key={option.id} marginBottom={isLastVisible ? 0 : 1}>
                <Box flexDirection="column">
                  <Text
                    color={isSelected ? POPUP_CONFIG.titleColor : option.danger ? POPUP_CONFIG.errorColor : 'white'}
                    bold={isSelected}
                  >
                    {isSelected ? '▶ ' : '  '}
                    {option.label}
                  </Text>
                  {option.description && (
                    <Box marginLeft={3}>
                      <Text dimColor>{option.description}</Text>
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
          {moreBelow && (
            <Text dimColor>↓ {options.length - end} more</Text>
          )}
        </Box>
      </PopupContainer>
    </PopupWrapper>
  );
};

// Entry point
function main() {
  const resultFile = process.argv[2];
  const dataFile = process.argv[3];

  if (!resultFile || !dataFile) {
    console.error('Error: Result file and data file required');
    process.exit(1);
  }

  let data: {
    title: string;
    message: string;
    options: ChoiceOption[];
    maxVisible?: number;
  };

  try {
    const dataJson = fs.readFileSync(dataFile, 'utf-8');
    data = JSON.parse(dataJson);
  } catch (error) {
    console.error('Error: Failed to read or parse data file');
    process.exit(1);
  }

  render(
    <ChoicePopupApp
      resultFile={resultFile}
      title={data.title}
      message={data.message}
      options={data.options}
      maxVisible={data.maxVisible}
    />
  );
}

main();
