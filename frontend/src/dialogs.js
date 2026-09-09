import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import './sweetalert-theme.css';

const baseOptions = {
  buttonsStyling: false,
  reverseButtons: true,
  focusCancel: true,
  customClass: {
    popup: 'certtrack-swal',
    title: 'certtrack-swal-title',
    htmlContainer: 'certtrack-swal-message',
    actions: 'certtrack-swal-actions',
    confirmButton: 'certtrack-swal-confirm',
    cancelButton: 'certtrack-swal-cancel',
    input: 'certtrack-swal-input',
  },
};

export async function confirmDelete({ name, itemLabel }) {
  const result = await Swal.fire({
    ...baseOptions,
    icon: 'warning',
    iconColor: '#ef4762',
    title: `Delete ${itemLabel}?`,
    text: `This will permanently remove ${name}. This action cannot be undone.`,
    showCancelButton: true,
    confirmButtonText: 'Delete',
    cancelButtonText: 'Cancel',
  });
  return result.isConfirmed;
}

export async function confirmCertificateReview({ name, approve }) {
  const result = await Swal.fire({
    ...baseOptions,
    icon: approve ? 'question' : 'warning',
    iconColor: approve ? '#5147e5' : '#ef4762',
    title: `${approve ? 'Approve' : 'Reject'} certificate?`,
    text: `${name} will be ${approve ? 'available as an active certificate' : 'kept as rejected'} for the employee.`,
    input: approve ? undefined : 'textarea',
    inputLabel: approve ? undefined : 'Reason for rejection',
    inputPlaceholder: approve ? undefined : 'Explain what the employee needs to correct...',
    inputValidator: approve ? undefined : (value) => !value?.trim() && 'Please enter the reason for rejection.',
    showCancelButton: true,
    confirmButtonText: approve ? 'Approve' : 'Reject',
    cancelButtonText: 'Cancel',
    customClass: {
      ...baseOptions.customClass,
      confirmButton: approve ? 'certtrack-swal-primary' : 'certtrack-swal-danger',
    },
  })
  if (!result.isConfirmed) return null
  return approve ? true : result.value.trim()
}

export function showProcessingAlert(title) {
  Swal.fire({
    ...baseOptions,
    title,
    text: 'Please wait while we update the certificate.',
    allowEscapeKey: false,
    allowOutsideClick: false,
    showConfirmButton: false,
    didOpen: () => Swal.showLoading(),
  })
}

export async function showResultAlert({ title, message, success = true }) {
  await Swal.fire({
    ...baseOptions,
    icon: success ? 'success' : 'error',
    iconColor: success ? '#10a58e' : '#ef4762',
    title,
    text: message,
    confirmButtonText: 'Done',
    customClass: {
      ...baseOptions.customClass,
      confirmButton: success ? 'certtrack-swal-primary' : 'certtrack-swal-danger',
    },
  })
}

export function closeAlert() {
  Swal.close()
}

export function showToastAlert(message) {
  const isError = /unable|failed|error|invalid|already(?: exists| been assigned)|not found|must(?: be| match)|denied|could not|too (?:large|big)|maximum file size/i.test(message)
  Swal.fire({
    toast: true,
    position: 'bottom-end',
    icon: isError ? 'error' : 'success',
    iconColor: isError ? '#ef4762' : '#10a58e',
    title: message,
    showConfirmButton: false,
    timer: 3200,
    timerProgressBar: true,
    customClass: {
      popup: 'certtrack-swal certtrack-swal-toast',
      title: 'certtrack-swal-title',
    },
  })
}

export async function promptForName({ title, label, placeholder, initialValue = '', confirmButtonText = 'Add category' }) {
  const result = await Swal.fire({
    ...baseOptions,
    title,
    text: label,
    input: 'text',
    inputValue: initialValue,
    inputPlaceholder: placeholder,
    inputAttributes: { autocapitalize: 'words', maxlength: 80 },
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: 'Cancel',
    customClass: { ...baseOptions.customClass, confirmButton: 'certtrack-swal-primary' },
    preConfirm: (value) => {
      const clean = value.trim();
      if (!clean) {
        Swal.showValidationMessage('Enter a category name.');
        return false;
      }
      return clean;
    },
  });
  return result.isConfirmed ? result.value : null;
}
