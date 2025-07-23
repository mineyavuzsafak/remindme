import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, TouchableOpacity, Platform, FlatList, Button, Alert } from 'react-native';
import * as Speech from 'expo-speech';
import Voice from '@react-native-voice/voice';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, addDays } from 'date-fns';

let temporaryReminder = null;

export default function HomeScreen() {
  const [isListening, setIsListening] = useState(false);
  const [reminders, setReminders] = useState([]);
  const [spokenText, setSpokenText] = useState('');
  const [error, setError] = useState('');
  const [conversationState, setConversationState] = useState('idle'); // idle, waiting_for_confirmation, waiting_for_reminder_content, waiting_for_time, waiting_for_date, waiting_for_both

  // --- IMPROVED PARSING FUNCTION ---
  const parseReminder = (text) => {
    let lowerText = text.toLowerCase().trim();
    let dateKeyword = null;
    let timeKeyword = null;
    let task = '';

    // Only parse if it starts with "remind me" - otherwise return empty task
    if (!startsWithRemindMe(text)) {
      return { task: '', time: null, date: null };
    }

    // 1. Extract time patterns
    const timePatterns = [
      /(\d{1,2}:\d{2}\s*(?:am|pm))/i, 
      /(\d{1,2}\s*(?:am|pm))/i,       
      /(\d{1,2}\s*o'?clock)/i,      
      /at\s*(\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)/i              
    ];
    for (const pattern of timePatterns) {
      const match = lowerText.match(pattern);
      if (match) {
        timeKeyword = match[1].replace('at ', '').trim();
        lowerText = lowerText.replace(match[0], '').trim();
        break;
      }
    }

    // 2. Extract date patterns
    const datePatterns = [
      /(\d+)\s*days?\s*later/i, 
      /next\s*week/i,
      /tomorrow/i,
      /today/i,
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
      /next\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
    ];
    for (const pattern of datePatterns) {
      const match = lowerText.match(pattern);
      if (match) {
        dateKeyword = match[0];
        lowerText = lowerText.replace(match[0], '').trim();
        break;
      }
    }
    
    // 3. Clean up task text
    const keywordsToRemove = ['remind me to', 'remind me that', 'remind me'];
    task = lowerText.trim();
    for (const keyword of keywordsToRemove) {
      if (task.startsWith(keyword)) {
        task = task.substring(keyword.length).trim();
        break;
      }
    }
    task = task.replace(/\s*(at|on)\s*$/i, '').trim();

    // 4. Convert date keywords to actual dates
    let formattedDate = null;
    if (dateKeyword) {
      const now = new Date();
      const lowerDate = dateKeyword.toLowerCase();
      if (lowerDate === 'today') {
        formattedDate = format(now, 'MMM d');
      } else if (lowerDate === 'tomorrow') {
        formattedDate = format(addDays(now, 1), 'MMM d');
      } else if (lowerDate.includes('days later')) {
        const daysToAdd = parseInt(lowerDate, 10);
        if (!isNaN(daysToAdd)) {
          formattedDate = format(addDays(now, daysToAdd), 'MMM d');
        }
      } else if (lowerDate === 'next week') {
        formattedDate = format(addDays(now, 7), 'MMM d');
      } else {
        formattedDate = dateKeyword;
      }
    }

    // 5. If only time is provided, assume today
    if (timeKeyword && !formattedDate) {
      formattedDate = format(new Date(), 'MMM d');
    }

    return { task, time: timeKeyword, date: formattedDate };
  };

  // Check if text starts with "remind me that"
  const startsWithRemindMe = (text) => {
    const lowerText = text.toLowerCase().trim();
    return lowerText.startsWith('remind me that') || 
           lowerText.startsWith('remind me to') || 
           lowerText.startsWith('remind me');
  };

  // Check for yes/no responses
  const isYesResponse = (text) => {
    const lowerText = text.toLowerCase().trim();
    return lowerText === 'yes' || lowerText === 'yeah' || lowerText === 'yep' || lowerText === 'sure';
  };

  const isNoResponse = (text) => {
    const lowerText = text.toLowerCase().trim();
    return lowerText === 'no' || lowerText === 'nope' || lowerText === 'nah';
  };
  
  const onSpeechStart = () => setIsListening(true);
  const onSpeechEnd = () => setIsListening(false);
  const onSpeechError = (e) => { 
    setError(JSON.stringify(e.error)); 
    setIsListening(false); 
  };
  const onSpeechResults = (e) => {
    if (e.value && e.value.length > 0) {
      setSpokenText(e.value[0]);
    }
  };

  useEffect(() => {
    loadReminders();
    Voice.onSpeechStart = onSpeechStart;
    Voice.onSpeechEnd = onSpeechEnd;
    Voice.onSpeechError = onSpeechError;
    Voice.onSpeechResults = onSpeechResults;
    return () => { 
      Voice.destroy().then(Voice.removeAllListeners); 
    };
  }, []);

  const startListening = async () => {
    setSpokenText('');
    setError('');
    try { 
      await Voice.start('en-US'); 
    } catch (e) { 
      console.error('Start listening error:', e); 
      setError('Failed to start listening');
    }
  };

  const stopListeningAndProcess = async () => {
    try {
      await Voice.stop();
      if (spokenText) {
        processVoiceResult(spokenText);
      }
    } catch (e) { 
      console.error('Stop listening error:', e); 
    }
  };

  const handleMicPress = async () => {
    if (isListening) { 
      await stopListeningAndProcess(); 
    } else { 
      await startListening(); 
    }
  };

  const speak = (text) => { 
    Speech.speak(text, { language: 'en-US' }); 
  };

  const saveReminder = async (newReminder) => {
    try {
      const newReminderWithId = { ...newReminder, id: Date.now().toString() };
      const updatedReminders = [...reminders, newReminderWithId];
      setReminders(updatedReminders);
      await AsyncStorage.setItem('reminders', JSON.stringify(updatedReminders));
      speak('Perfect! I will remind you.');
      temporaryReminder = null;
      setConversationState('idle');
    } catch (e) { 
      console.error('Failed to save reminder.', e); 
      speak('Sorry, I had trouble saving your reminder. Please try again.');
    }
  };

  const processVoiceResult = (text) => {
    if (!text) return;

    console.log('Processing:', text, 'State:', conversationState);

    switch (conversationState) {
      case 'idle':
        // Check if it starts with "remind me that"
        if (startsWithRemindMe(text)) {
          const { task, time, date } = parseReminder(text);
          
          if (task && time && date) {
            // Complete reminder - save it
            saveReminder({ task, time, date });
          } else if (task && (time || date)) {
            // Missing either time or date
            temporaryReminder = { task, time, date };
            if (!time && date) {
              setConversationState('waiting_for_time');
              speak('What time should I remind you?');
            } else if (time && !date) {
              setConversationState('waiting_for_date');
              speak('When should I remind you?');
            }
          } else if (task && task.length > 0) {
            // Only task provided
            temporaryReminder = { task };
            setConversationState('waiting_for_both');
            speak('When and at what time should I remind you?');
          } else {
            // No valid task found
            speak('I couldn\'t understand what you want me to remind you about. Please try again.');
          }
        } else {
          // Doesn't start with "remind me that"
          setConversationState('waiting_for_confirmation');
          speak('Did you mean to set a reminder?');
        }
        break;

      case 'waiting_for_confirmation':
        if (isYesResponse(text)) {
          setConversationState('waiting_for_reminder_content');
          speak('Tell me what I should remind you later.');
        } else if (isNoResponse(text)) {
          setConversationState('idle');
          speak('Alright. Whenever you need to set a reminder, just say "remind me that".');
        } else {
          speak('Please say yes or no. Did you mean to set a reminder?');
        }
        break;

      case 'waiting_for_reminder_content':
        const { task, time, date } = parseReminder(text);
        
        if (task && time && date) {
          // Complete reminder
          saveReminder({ task, time, date });
        } else if (task && (time || date)) {
          // Missing either time or date
          temporaryReminder = { task, time, date };
          if (!time && date) {
            setConversationState('waiting_for_time');
            speak('What time should I remind you?');
          } else if (time && !date) {
            setConversationState('waiting_for_date');
            speak('When should I remind you?');
          }
        } else if (task) {
          // Only task provided
          temporaryReminder = { task };
          setConversationState('waiting_for_both');
          speak('When and at what time should I remind you?');
        } else {
          speak('I couldn\'t understand what you want me to remind you about. Please try again.');
        }
        break;

      case 'waiting_for_time':
        const timeInfo = parseReminder(text);
        if (timeInfo.time && temporaryReminder) {
          const finalReminder = { 
            ...temporaryReminder, 
            time: timeInfo.time,
            date: temporaryReminder.date || format(new Date(), 'MMM d')
          };
          saveReminder(finalReminder);
        } else {
          speak('I couldn\'t understand the time. Please tell me what time I should remind you.');
        }
        break;

      case 'waiting_for_date':
        const dateInfo = parseReminder(text);
        if (dateInfo.date && temporaryReminder) {
          const finalReminder = { 
            ...temporaryReminder, 
            date: dateInfo.date 
          };
          saveReminder(finalReminder);
        } else {
          speak('I couldn\'t understand when you want to be reminded. Please tell me the day.');
        }
        break;

      case 'waiting_for_both':
        const bothInfo = parseReminder(text);
        if (bothInfo.time && bothInfo.date && temporaryReminder) {
          const finalReminder = { 
            ...temporaryReminder, 
            time: bothInfo.time, 
            date: bothInfo.date 
          };
          saveReminder(finalReminder);
        } else if (bothInfo.time || bothInfo.date) {
          // Got partial info, ask for the missing piece
          temporaryReminder = { ...temporaryReminder, ...bothInfo };
          if (!bothInfo.time) {
            setConversationState('waiting_for_time');
            speak('What time should I remind you?');
          } else if (!bothInfo.date) {
            setConversationState('waiting_for_date');
            speak('When should I remind you?');
          }
        } else {
          speak('I need to know when and at what time. Please tell me both the day and time.');
        }
        break;

      default:
        setConversationState('idle');
        break;
    }
  };

  const loadReminders = async () => {
    try {
      const savedReminders = await AsyncStorage.getItem('reminders');
      if (savedReminders !== null) {
        setReminders(JSON.parse(savedReminders));
      }
    } catch (e) { 
      console.error('Failed to load reminders.', e); 
    }
  };
  
  const clearAllReminders = async () => {
    Alert.alert(
      "Clear All Reminders", 
      "Are you sure you want to delete all reminders?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Yes, Clear All", 
          onPress: async () => {
            try { 
              await AsyncStorage.removeItem('reminders'); 
              setReminders([]); 
            } catch(e) { 
              console.error('Failed to clear reminders.', e); 
            }
          }, 
          style: 'destructive'
        }
      ]
    );
  };

  const resetConversation = () => {
    setConversationState('idle');
    temporaryReminder = null;
    setSpokenText('');
    setError('');
  };

  const getStatusText = () => {
    if (error) return 'An error occurred';
    if (isListening) {
      if (spokenText) return spokenText;
      switch (conversationState) {
        case 'waiting_for_confirmation':
          return 'Listening for yes/no...';
        case 'waiting_for_reminder_content':
          return 'Listening for reminder...';
        case 'waiting_for_time':
          return 'Listening for time...';
        case 'waiting_for_date':
          return 'Listening for date...';
        case 'waiting_for_both':
          return 'Listening for time and date...';
        default:
          return 'Listening...';
      }
    }
    
    switch (conversationState) {
      case 'waiting_for_confirmation':
        return 'Say yes or no';
      case 'waiting_for_reminder_content':
        return 'Tell me your reminder';
      case 'waiting_for_time':
        return 'Tell me the time';
      case 'waiting_for_date':
        return 'Tell me the date';
      case 'waiting_for_both':
        return 'Tell me time and date';
      default:
        return 'Tap to speak';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        <Text style={styles.title}>🎤 RemindMe</Text>
        <Text style={styles.subtitle}>Your smart voice assistant</Text>
        {conversationState !== 'idle' && (
          <Text style={styles.conversationState}>
            {conversationState.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </Text>
        )}
      </View>
      
      <View style={styles.debugContainer}>
        <View style={styles.buttonRow}>
          <Button title="Clear All Reminders" onPress={clearAllReminders} color="#ef4444" />
          <Button title="Reset Conversation" onPress={resetConversation} color="#f59e0b" />
        </View>
        <Text style={styles.debugText}>State: {conversationState}</Text>
        {spokenText && <Text style={styles.debugText}>Last heard: "{spokenText}"</Text>}
      </View>
      
      <FlatList
        data={reminders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.reminderCard}>
            <Text style={styles.reminderTask}>{item.task}</Text>
            {(item.date || item.time) && (
              <Text style={styles.reminderTime}>
                {item.date}{item.date && item.time ? ' - ' : ''}{item.time}
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No reminders yet. Say "Remind me that..." to add one!
          </Text>
        }
        contentContainerStyle={styles.listContent}
      />
      
      <View style={styles.micContainer}>
        <TouchableOpacity 
          style={[
            styles.micButton, 
            isListening && styles.micButtonListening,
            conversationState !== 'idle' && styles.micButtonConversation
          ]} 
          onPress={handleMicPress}
        >
          <Text style={styles.micIcon}>🎤</Text>
        </TouchableOpacity>
        <Text style={styles.statusText}>
          {getStatusText()}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#1e3a8a' 
  },
  headerContainer: { 
    paddingVertical: 10, 
    paddingHorizontal: 20, 
    alignItems: 'center' 
  },
  title: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    color: '#fff' 
  },
  subtitle: { 
    fontSize: 14, 
    color: 'rgba(255, 255, 255, 0.8)' 
  },
  conversationState: {
    fontSize: 12,
    color: '#fbbf24',
    marginTop: 5,
    fontWeight: '500'
  },
  debugContainer: { 
    marginHorizontal: 20, 
    marginBottom: 10 
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  debugText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginTop: 5,
  },
  listContent: { 
    paddingHorizontal: 20, 
    paddingBottom: 20, 
    flexGrow: 1 
  },
  reminderCard: { 
    backgroundColor: 'rgba(255, 255, 255, 0.1)', 
    borderRadius: 10, 
    padding: 15, 
    marginBottom: 15 
  },
  reminderTask: { 
    color: '#fff', 
    fontSize: 16, 
    fontWeight: '600' 
  },
  reminderTime: { 
    color: 'rgba(255, 255, 255, 0.7)', 
    fontSize: 12, 
    marginTop: 5 
  },
  emptyText: { 
    color: 'rgba(255, 255, 255, 0.5)', 
    textAlign: 'center', 
    marginTop: 50 
  },
  micContainer: { 
    alignItems: 'center', 
    padding: 20, 
    borderTopWidth: 1, 
    borderTopColor: 'rgba(255, 255, 255, 0.2)' 
  },
  micButton: { 
    width: 100, 
    height: 100, 
    borderRadius: 50, 
    backgroundColor: '#10b981', 
    justifyContent: 'center', 
    alignItems: 'center', 
    elevation: 10, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 5 }, 
    shadowOpacity: 0.3, 
    shadowRadius: 5 
  },
  micButtonListening: { 
    backgroundColor: '#ef4444' 
  },
  micButtonConversation: {
    backgroundColor: '#f59e0b'
  },
  micIcon: { 
    fontSize: 50 
  },
  statusText: { 
    marginTop: 15, 
    fontSize: 16, 
    color: '#fff', 
    fontWeight: '500', 
    minHeight: 20,
    textAlign: 'center'
  },
});