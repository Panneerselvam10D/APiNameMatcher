/**
 * Formats a date string to DD/MMM/YYYY format
 * @param {string|Date} date - Date string or Date object
 * @returns {string} Formatted date string (e.g., "01/Jan/2000")
 */
export const formatDateForApi = (date) => {
  if (!date) return '';
  
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  
  let dateObj = date;
  
  // If it's a string, try to parse it
  if (typeof date === 'string') {
    // Try to parse different date formats
    const parsedDate = new Date(date);
    if (!isNaN(parsedDate.getTime())) {
      dateObj = parsedDate;
    } else {
      // Try to parse DD/MM/YYYY or DD-MM-YYYY
      const parts = date.split(/[/-]/);
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const year = parseInt(parts[2], 10);
        dateObj = new Date(year, month, day);
      }
    }
  }
  
  // If we still don't have a valid date, return empty string
  if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    console.warn('Invalid date:', date);
    return '';
  }
  
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = months[dateObj.getMonth()];
  const year = dateObj.getFullYear();
  
  return `${day}/${month}/${year}`;
};

export default {
  formatDateForApi
};
